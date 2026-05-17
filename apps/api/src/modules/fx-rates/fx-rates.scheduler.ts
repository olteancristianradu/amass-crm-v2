import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_FX_RATES } from '../../infra/queue/queue.constants';

/**
 * Phase 0 / Feature 2 — ECB daily fetch cron.
 *
 * Fires at 06:00 Europe/Bucharest every day. ECB publishes the daily
 * file around 16:00 CET, so by 06:00 the next morning the previous
 * business day's rates are guaranteed available — including the
 * weekend-Monday case where Saturday's cron fires on Friday's rates
 * (ECB doesn't publish on weekends; spec 2.1 weekend scenario).
 *
 * The job is enqueued with `jobId = fx-daily-YYYYMMDD` in the local
 * timezone so two concurrent fires (machine restart, schedule re-run)
 * collapse into one BullMQ entry — Redis dedupes by jobId. T-FX-T-04
 * mitigation: combined with the unique `(from, to, asOf)` index in the
 * DB, this makes double-insert impossible.
 *
 * The scheduler is intentionally just a fan-in: build the deterministic
 * jobId and hand off. The processor does the actual fetch + upsert +
 * sanity check + metric increment. Failures in the processor are
 * retried by BullMQ (timeout 15s, 3 attempts, exponential backoff per
 * T-FX-D-01) without bothering the scheduler.
 */
@Injectable()
export class FxRatesScheduler {
  private readonly logger = new Logger(FxRatesScheduler.name);

  constructor(
    @InjectQueue(QUEUE_FX_RATES) private readonly queue: Queue,
  ) {}

  /**
   * Daily at 06:00 Europe/Bucharest. The cron expression itself is in the
   * IANA timezone passed via `timeZone` — @nestjs/schedule honours it.
   */
  @Cron('0 6 * * *', { name: 'fx-rates-daily', timeZone: 'Europe/Bucharest' })
  async handleDaily(): Promise<void> {
    try {
      await this.enqueue();
    } catch (err) {
      this.logger.error(
        `fx-rates daily fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Exposed for manual triggers (admin endpoint, smoke test, replay) so
   * the cron logic + jobId construction is in exactly one place.
   */
  async enqueue(now: Date = new Date()): Promise<{ jobId: string }> {
    // Compute YYYYMMDD in Europe/Bucharest so the jobId aligns with the
    // cron's timezone. Intl is the supported way to do this in Node 22.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const localDate = fmt.format(now); // "2026-05-17"
    const stamp = localDate.replace(/-/g, ''); // "20260517"
    const jobId = `fx-daily-${stamp}`;

    await this.queue.add(
      'fx-rates-daily',
      { localDate },
      {
        jobId,
        // T-FX-D-01: bounded retries, exponential backoff. ECB usually
        // recovers within minutes, never hours. After 3 attempts the job
        // sits in the failed set; an operator alert (`fx_rates_fetched_
        // total{status="error"} > 0` over 1h) catches sustained outage.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        // 15s gives us 1.5x the worker timeout (10s ECB fetch) with
        // headroom for the upsert loop (~30 rows).
        // Total wall-clock cap including retries: ~5min.
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    );
    this.logger.log(`fx-rates daily enqueued jobId=${jobId} (Bucharest=${localDate})`);
    return { jobId };
  }
}
