import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_EMAIL_TRACKS_PII } from '../../infra/queue/queue.constants';
import { EmailTrackingService } from './email-tracking.service';

interface EmailTracksPiiPayload {
  /** YYYY-MM-DD bucket in Europe/Bucharest — just for log readability. */
  localDate: string;
}

/**
 * Phase 1 F1 — BullMQ worker that drains the email_tracks PII anonymisation
 * queue. Calls `EmailTrackingService.purgePiiBatch` in 1k-row batches until
 * it returns 0, then exits — the next day's cron picks up any new rows.
 *
 * Concurrency: 1. The work is intentionally serial across this queue so
 * two pods can never race the same batch; the unique cron jobId per day
 * already prevents concurrent enqueues, but we keep concurrency=1 as
 * defense in depth.
 *
 * Per-run upper bound: 200 batches × 1000 rows = 200k rows. At a steady
 * state of ≤10k tracked events per tenant per day this never reaches the
 * cap; if it does, we log and exit (next day cleans up the rest).
 */
@Processor(QUEUE_EMAIL_TRACKS_PII, {
  concurrency: 1,
  // Each batch is a single updateMany on indexed rows — fast. 60s lock is
  // generous enough for the longest batch we expect (large tenant + cold cache).
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class EmailTracksPiiProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailTracksPiiProcessor.name);
  private static readonly MAX_BATCHES_PER_RUN = 200;
  private static readonly BATCH_SIZE = 1000;
  private static readonly OLDER_THAN_DAYS = 90;

  constructor(private readonly tracking: EmailTrackingService) {
    super();
  }

  async process(job: Job<EmailTracksPiiPayload>): Promise<void> {
    if (job.name !== 'purge') {
      this.logger.warn(`Unknown job name on ${QUEUE_EMAIL_TRACKS_PII}: ${job.name}`);
      return;
    }

    let totalPurged = 0;
    let batches = 0;
    while (batches < EmailTracksPiiProcessor.MAX_BATCHES_PER_RUN) {
      const purged = await this.tracking.purgePiiBatch(
        EmailTracksPiiProcessor.OLDER_THAN_DAYS,
        EmailTracksPiiProcessor.BATCH_SIZE,
      );
      if (purged === 0) break;
      totalPurged += purged;
      batches += 1;
    }

    if (batches >= EmailTracksPiiProcessor.MAX_BATCHES_PER_RUN) {
      this.logger.warn(
        `email-tracks PII purge hit MAX_BATCHES_PER_RUN=${EmailTracksPiiProcessor.MAX_BATCHES_PER_RUN}; ${totalPurged} rows purged, more remaining for next run`,
      );
    } else {
      this.logger.log(
        `email-tracks PII purge complete: ${totalPurged} rows in ${batches} batches`,
      );
    }
  }
}
