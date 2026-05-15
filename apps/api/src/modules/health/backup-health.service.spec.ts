import { Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import 'reflect-metadata';
import type { Gauge } from 'prom-client';

// @nestjs/schedule stores @Cron metadata under this Reflect key. It is not
// re-exported from the package entry point, so we duplicate the constant
// literal here. Confirmed against
//   node_modules/@nestjs/schedule/dist/schedule.constants.d.ts (v6.1.3):
//     export declare const SCHEDULE_CRON_OPTIONS = "SCHEDULE_CRON_OPTIONS";
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetEnvCacheForTests } from '../../config/env';
import { BackupHealthService } from './backup-health.service';

/**
 * Tests for BackupHealthService.
 *
 * Strategy: instead of mocking the minio package at module level (brittle
 * across hoisting), we build the service via Nest's testing module with a
 * stub Gauge, then in onModuleInit reach into the private `client` slot
 * and substitute a fake whose `getObject` returns a controlled stream.
 * That keeps the test fully synchronous around the cron tick.
 *
 * Coverage targets:
 *   - happy path → gauge.set called with parsed timestamp
 *   - malformed JSON → gauge untouched, warn logged
 *   - missing/invalid timestamp field → gauge untouched, warn logged
 *   - S3 NoSuchKey (404) → gauge untouched, warn logged
 *   - generic S3 error → gauge untouched, warn logged
 *   - disabled mode (env not set) → no client built, cron is a no-op
 *   - @Cron decorator present with `* /5 * * * *` schedule (reflect-metadata)
 */

type GaugeStub = { set: ReturnType<typeof vi.fn> };
type ClientStub = { getObject: ReturnType<typeof vi.fn> };

function makeBackupEnv(): NodeJS.ProcessEnv {
  // Minimum required env for loadEnv() to succeed, plus BACKUP_* so the
  // service enters the "enabled" branch in onModuleInit.
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEY: '0'.repeat(64),
    BACKUP_S3_ENDPOINT: 'http://backup-s3:9000',
    BACKUP_S3_ACCESS_KEY: 'ak',
    BACKUP_S3_SECRET_KEY: 'sk',
    BACKUP_BUCKET: 'amass-backups',
  };
}

async function buildService(overrideEnv?: NodeJS.ProcessEnv): Promise<{
  svc: BackupHealthService;
  gauge: GaugeStub;
}> {
  // Reset module-level env cache so each test sees its own process.env.
  _resetEnvCacheForTests();
  if (overrideEnv) {
    for (const [k, v] of Object.entries(overrideEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const gauge: GaugeStub = { set: vi.fn() };
  const moduleRef = await Test.createTestingModule({
    providers: [
      BackupHealthService,
      {
        provide: getToken('backup_last_success_timestamp_seconds'),
        useValue: gauge as unknown as Gauge<string>,
      },
    ],
  }).compile();
  const svc = moduleRef.get(BackupHealthService);
  return { svc, gauge };
}

/** Inject a fake minio client into the service (private field via cast). */
function setClient(svc: BackupHealthService, client: ClientStub | null, bucket: string | null = 'amass-backups'): void {
  const internal = svc as unknown as {
    client: ClientStub | null;
    bucket: string | null;
  };
  internal.client = client;
  internal.bucket = bucket;
}

function streamFrom(body: string): Readable {
  return Readable.from([Buffer.from(body, 'utf-8')]);
}

const ORIGINAL_ENV = { ...process.env };

describe('BackupHealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore env between tests so one test's mutations do not leak.
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
      process.env[k] = v;
    }
    Object.assign(process.env, makeBackupEnv());
  });

  afterEach(() => {
    _resetEnvCacheForTests();
  });

  it('happy path: parses heartbeat JSON and sets the gauge with the timestamp', async () => {
    const { svc, gauge } = await buildService();
    svc.onModuleInit();
    const getObject = vi.fn().mockResolvedValue(
      streamFrom('{"timestamp": 1715760000, "host": "vps-1", "db": "amass_crm", "duration_seconds": 47, "size_bytes": 12345678}'),
    );
    setClient(svc, { getObject });

    await svc.pollHeartbeat();

    expect(getObject).toHaveBeenCalledWith('amass-backups', '_heartbeat.json');
    expect(gauge.set).toHaveBeenCalledTimes(1);
    expect(gauge.set).toHaveBeenCalledWith(1715760000);
  });

  it('malformed JSON: leaves gauge unchanged and logs warn', async () => {
    const { svc, gauge } = await buildService();
    svc.onModuleInit();
    const warnSpy = vi.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    setClient(svc, {
      getObject: vi.fn().mockResolvedValue(streamFrom('not-valid-json {{{')),
    });

    await svc.pollHeartbeat();

    expect(gauge.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('missing timestamp field: leaves gauge unchanged and logs warn', async () => {
    const { svc, gauge } = await buildService();
    svc.onModuleInit();
    const warnSpy = vi.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    setClient(svc, {
      getObject: vi.fn().mockResolvedValue(streamFrom('{"host": "vps-1", "db": "amass_crm"}')),
    });

    await svc.pollHeartbeat();

    expect(gauge.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing/invalid `timestamp`'),
    );
  });

  it('S3 NoSuchKey (404): leaves gauge unchanged and logs the "not found" warning', async () => {
    const { svc, gauge } = await buildService();
    svc.onModuleInit();
    const warnSpy = vi.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    const notFound: Error & { code?: string } = Object.assign(new Error('not found'), { code: 'NoSuchKey' });
    setClient(svc, { getObject: vi.fn().mockRejectedValue(notFound) });

    await svc.pollHeartbeat();

    expect(gauge.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found at s3://'));
  });

  it('generic S3 error: leaves gauge unchanged and logs warn (does NOT throw)', async () => {
    const { svc, gauge } = await buildService();
    svc.onModuleInit();
    const warnSpy = vi.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    setClient(svc, { getObject: vi.fn().mockRejectedValue(new Error('connection refused')) });

    await expect(svc.pollHeartbeat()).resolves.toBeUndefined();
    expect(gauge.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fetch failed'));
  });

  it('disabled mode: missing BACKUP_S3 env → onModuleInit warns once, pollHeartbeat is a no-op', async () => {
    // Re-init with BACKUP_S3_* unset.
    const env = makeBackupEnv();
    delete env.BACKUP_S3_ENDPOINT;
    delete env.BACKUP_S3_ACCESS_KEY;
    delete env.BACKUP_S3_SECRET_KEY;
    delete env.BACKUP_BUCKET;
    for (const k of ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY', 'BACKUP_BUCKET']) {
      delete process.env[k];
    }
    _resetEnvCacheForTests();

    const { svc, gauge } = await buildService();
    const warnSpy = vi.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    svc.onModuleInit();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));

    await svc.pollHeartbeat();
    expect(gauge.set).not.toHaveBeenCalled();
  });

  it('@Cron decorator is present with "*/5 * * * *" schedule', () => {
    // Reflect-metadata: @nestjs/schedule stores cron options on the method.
    const proto = BackupHealthService.prototype as unknown as Record<string, unknown>;
    const method = proto.pollHeartbeat;
    expect(typeof method).toBe('function');
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method as object) as
      | { cronTime?: string; name?: string }
      | undefined;
    expect(meta).toBeDefined();
    expect(meta?.cronTime).toBe('*/5 * * * *');
    expect(meta?.name).toBe('backup-heartbeat-poll');
  });
});
