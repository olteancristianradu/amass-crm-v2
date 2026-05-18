import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_CONTRACT_REMINDER } from '../../../infra/queue/queue.constants';

/**
 * Phase 2 F1 — daily 09:00 Europe/Bucharest cron that enqueues a single
 * 'reminder-sweep' job. The processor iterates pending signers across
 * tenants and decides per-row whether a reminder cadence offset is hit.
 *
 * Deterministic jobId per day (`contract-reminder-YYYYMMDD`) so two cron
 * fires (e.g. restart) collapse to one effective sweep.
 */
@Injectable()
export class ContractReminderScheduler {
  private readonly logger = new Logger(ContractReminderScheduler.name);

  constructor(@InjectQueue(QUEUE_CONTRACT_REMINDER) private readonly queue: Queue) {}

  @Cron('0 9 * * *', { name: 'contract-reminder-cron', timeZone: 'Europe/Bucharest' })
  async handleTick(): Promise<void> {
    try {
      await this.enqueue();
    } catch (err) {
      this.logger.error(
        `contract-reminder cron fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async enqueue(now: Date = new Date()): Promise<{ jobId: string }> {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const stamp = `${pick('year')}${pick('month')}${pick('day')}`;
    const jobId = `contract-reminder-${stamp}`;

    await this.queue.add(
      'reminder-sweep',
      { stamp },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`contract-reminder enqueued jobId=${jobId}`);
    return { jobId };
  }
}
