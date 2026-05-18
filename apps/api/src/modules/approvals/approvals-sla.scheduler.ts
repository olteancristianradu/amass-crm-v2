import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_APPROVAL_SLA } from '../../infra/queue/queue.constants';

/**
 * Phase 2 F2 — SLA expiry cron. Fires every 15 minutes Europe/Bucharest
 * and enqueues one 'sla-sweep' job with a deterministic jobId
 * (`approval-sla-YYYYMMDDHHMM`) so two concurrent fires (machine restart,
 * cron drift) collapse to one run.
 *
 * Per spec phase-2.md F2.4, the cron tick fires every 15min — fine-grained
 * enough that an SLA passes the deadline by at most 15min in the worst
 * case. Tightening to 5min is cheap; coarsening to 1h is also safe (SLAs
 * are hour-granular).
 */
@Injectable()
export class ApprovalsSlaScheduler {
  private readonly logger = new Logger(ApprovalsSlaScheduler.name);

  constructor(
    @InjectQueue(QUEUE_APPROVAL_SLA) private readonly queue: Queue,
  ) {}

  @Cron('*/15 * * * *', { name: 'approval-sla-sweep', timeZone: 'Europe/Bucharest' })
  async handleTick(): Promise<void> {
    try {
      await this.enqueue();
    } catch (err) {
      this.logger.error(
        `approval-sla cron fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Exposed for manual triggers (admin endpoint, smoke test) so the cron
   * logic + jobId construction lives in exactly one place.
   */
  async enqueue(now: Date = new Date()): Promise<{ jobId: string }> {
    // YYYYMMDDHHMM bucket in Europe/Bucharest. The minute is floored to the
    // nearest /15 so cron ticks within the same window collapse to one job.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const flooredMin = String(Math.floor(Number(pick('minute')) / 15) * 15).padStart(2, '0');
    const stamp = `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}${flooredMin}`;
    const jobId = `approval-sla-${stamp}`;

    await this.queue.add(
      'sla-sweep',
      { stamp },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    );
    this.logger.log(`approval-sla enqueued jobId=${jobId}`);
    return { jobId };
  }
}
