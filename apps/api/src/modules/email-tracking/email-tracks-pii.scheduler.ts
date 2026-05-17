import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_EMAIL_TRACKS_PII } from '../../infra/queue/queue.constants';

/**
 * Phase 1 F1 — GDPR daily PII purge scheduler.
 *
 * Mitigates T-MAIL-I-01 (long-term retention of recipient IP/UA on every
 * open + click). Per Phase-1 spec we anonymise after 90 days: nullify
 * ip_address + user_agent on `email_tracks` rows, stamp `pii_hashed_at`.
 *
 * Fires daily at 03:00 Europe/Bucharest. The processor picks up the job
 * and loops `purgePiiBatch(90, 1000)` until it returns 0 (= no more work
 * for today). Single deterministic jobId per day means a restart during
 * the run won't double-enqueue.
 */
@Injectable()
export class EmailTracksPiiScheduler {
  private readonly logger = new Logger(EmailTracksPiiScheduler.name);

  constructor(
    @InjectQueue(QUEUE_EMAIL_TRACKS_PII) private readonly queue: Queue,
  ) {}

  @Cron('0 3 * * *', { name: 'email-tracks-pii-daily', timeZone: 'Europe/Bucharest' })
  async handleDaily(): Promise<void> {
    try {
      await this.enqueue();
    } catch (err) {
      this.logger.error(
        `email-tracks PII purge fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Exposed for admin replay + tests. JobId is bucketed by YYYYMMDD in the
   * cron's timezone so two enqueue calls in the same local day collapse to
   * one BullMQ entry — Redis dedupes by jobId.
   */
  async enqueue(now: Date = new Date()): Promise<{ jobId: string }> {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const localDate = fmt.format(now); // "2026-05-17"
    const stamp = localDate.replace(/-/g, ''); // "20260517"
    const jobId = `email-tracks-pii-${stamp}`;

    await this.queue.add(
      'purge',
      { localDate },
      {
        jobId,
        // The work is batched + safe to restart, so we don't need attempts > 1:
        // if the cron crashes mid-run, tomorrow's run picks up where this
        // one left off (the partial index makes it O(rows_remaining)).
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    );
    this.logger.log(`email-tracks PII purge enqueued jobId=${jobId} (Bucharest=${localDate})`);
    return { jobId };
  }
}
