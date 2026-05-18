import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_CONTRACT_EXPIRE } from '../../../infra/queue/queue.constants';

/**
 * Phase 2 F1 — hourly ceremony expiry sweep. JobId per hour bucket
 * (`contract-expire-YYYYMMDDHH`) so two cron fires within the same hour
 * collapse to one effective sweep.
 */
@Injectable()
export class ContractExpireScheduler {
  private readonly logger = new Logger(ContractExpireScheduler.name);

  constructor(@InjectQueue(QUEUE_CONTRACT_EXPIRE) private readonly queue: Queue) {}

  @Cron('0 * * * *', { name: 'contract-expire-cron', timeZone: 'Europe/Bucharest' })
  async handleTick(): Promise<void> {
    try {
      await this.enqueue();
    } catch (err) {
      this.logger.error(
        `contract-expire cron fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async enqueue(now: Date = new Date()): Promise<{ jobId: string }> {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const stamp = `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}`;
    const jobId = `contract-expire-${stamp}`;

    await this.queue.add(
      'expire-sweep',
      { stamp },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    );
    this.logger.log(`contract-expire enqueued jobId=${jobId}`);
    return { jobId };
  }
}
