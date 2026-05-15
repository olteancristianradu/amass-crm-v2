/**
 * BackupHealthService — periodic poller that surfaces the freshness of the
 * nightly Postgres backup as a Prometheus gauge.
 *
 * Pipeline:
 *   1. `scripts/backup-db.sh` runs at 02:00 daily inside the `db-backup`
 *      Docker sidecar. On full success its LAST step writes a small JSON
 *      marker to `s3://${BACKUP_BUCKET}/_heartbeat.json`:
 *        { timestamp: <unix>, host, db, duration_seconds, size_bytes }
 *   2. This service runs every 5 minutes inside the API process, fetches
 *      that file, parses the timestamp, and sets the
 *      `backup_last_success_timestamp_seconds` gauge.
 *   3. Prometheus scrapes /metrics; Alertmanager fires `BackupStale` if
 *      `time() - backup_last_success_timestamp_seconds > 90000` (25h).
 *
 * Why a separate S3 client (not StorageService): the backup bucket lives on
 * BACKUP_S3_ENDPOINT (possibly a different provider — R2/B2/external MinIO —
 * for disaster-recovery isolation), distinct from the application MinIO that
 * StorageService wraps.
 *
 * Failure semantics:
 *   - First boot / no backup yet → NotFound. We DO NOT zero the gauge —
 *     leaving it unset lets Prometheus's `absent()` distinguish "never seen"
 *     from "very stale" (BackupNeverRun alert vs BackupStale).
 *   - Transient network / JSON parse error → log warn, leave gauge alone.
 *   - Missing env (BACKUP_S3_* unset) → log once at boot, skip polling
 *     entirely (e.g. local dev where no backup is configured).
 *
 * Never throws. Any exception inside the cron tick is swallowed and logged.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Client as MinioClient } from 'minio';
import type { Gauge } from 'prom-client';
import { loadEnv } from '../../config/env';

interface HeartbeatPayload {
  timestamp: number;
  host?: string;
  db?: string;
  duration_seconds?: number;
  size_bytes?: number;
}

@Injectable()
export class BackupHealthService implements OnModuleInit {
  private readonly logger = new Logger(BackupHealthService.name);
  private readonly env = loadEnv();
  private client: MinioClient | null = null;
  private bucket: string | null = null;

  constructor(
    @InjectMetric('backup_last_success_timestamp_seconds')
    private readonly heartbeatGauge: Gauge<string>,
  ) {}

  /**
   * Build the S3 client at boot — fail-soft if BACKUP_S3_* env vars are
   * absent (typical for local dev). On prod the docker-compose injects them.
   */
  onModuleInit(): void {
    const { BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY, BACKUP_BUCKET } = this.env;
    if (!BACKUP_S3_ENDPOINT || !BACKUP_S3_ACCESS_KEY || !BACKUP_S3_SECRET_KEY || !BACKUP_BUCKET) {
      this.logger.warn(
        'BackupHealthService disabled: BACKUP_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET not all set. ' +
          'No backup heartbeat polling — backup_last_success_timestamp_seconds gauge will stay unset.',
      );
      return;
    }
    try {
      const u = new URL(BACKUP_S3_ENDPOINT);
      this.client = new MinioClient({
        endPoint: u.hostname,
        port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
        useSSL: u.protocol === 'https:',
        accessKey: BACKUP_S3_ACCESS_KEY,
        secretKey: BACKUP_S3_SECRET_KEY,
      });
      this.bucket = BACKUP_BUCKET;
      this.logger.log(
        `BackupHealthService initialised — polling s3://${BACKUP_BUCKET}/_heartbeat.json every 5 min`,
      );
    } catch (err) {
      this.logger.error(
        `BackupHealthService init failed (bad BACKUP_S3_ENDPOINT?): ${(err as Error).message}`,
      );
      this.client = null;
    }
  }

  /**
   * Cron tick — every 5 min. Public so unit tests can call it directly
   * without waiting for the scheduler.
   *
   * Cron expression `STAR/5 STAR STAR STAR STAR` = every five minutes,
   * matching the alert's `for: 5m` window. Tighter polling buys nothing
   * since the source data only changes once a day.
   */
  @Cron('*/5 * * * *', { name: 'backup-heartbeat-poll' })
  async pollHeartbeat(): Promise<void> {
    if (!this.client || !this.bucket) {
      // Already warned at boot — silent skip on the cron path.
      return;
    }
    try {
      const raw = await this.fetchHeartbeatBody(this.client, this.bucket);
      const parsed: unknown = JSON.parse(raw);
      const ts = this.extractTimestamp(parsed);
      if (ts === null) {
        this.logger.warn(
          'Backup heartbeat fetched but missing/invalid `timestamp` field — gauge unchanged',
        );
        return;
      }
      this.heartbeatGauge.set(ts);
    } catch (err) {
      // The minio SDK throws a NoSuchKey error with `.code === 'NoSuchKey'`
      // when the heartbeat file does not exist yet (first run / fresh
      // bucket). We log it but keep the gauge unset so Alertmanager's
      // `absent()` rule can distinguish "never seen" from "stale".
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'NoSuchKey' || code === 'NotFound') {
        this.logger.warn(
          `Backup heartbeat not found at s3://${this.bucket}/_heartbeat.json — gauge unchanged (relies on absent() alert)`,
        );
      } else {
        this.logger.warn(`Backup heartbeat fetch failed: ${msg} — gauge unchanged`);
      }
    }
  }

  /**
   * Read `_heartbeat.json` as a UTF-8 string. Extracted for test seam —
   * specs replace the minio stream with a stub.
   */
  private async fetchHeartbeatBody(client: MinioClient, bucket: string): Promise<string> {
    const stream = await client.getObject(bucket, '_heartbeat.json');
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  /**
   * Pull `timestamp` (seconds since epoch) from the parsed JSON. Returns
   * null if the shape is wrong rather than throwing — callers treat that
   * as "leave the gauge alone".
   */
  private extractTimestamp(payload: unknown): number | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const ts = (payload as HeartbeatPayload).timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
    return ts;
  }
}
