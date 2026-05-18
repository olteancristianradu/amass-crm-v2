import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_CONTRACT_REMINDER } from '../../../infra/queue/queue.constants';
import { ContractSweeperService } from '../services/contract-sweeper.service';

interface ReminderSweepPayload {
  stamp: string;
}

/**
 * Phase 2 F1 — BullMQ consumer for the contract-reminder queue.
 *
 * Concurrency 1, lockDuration 120s — the sweep iterates tenants serially
 * and is bounded by the contract pipeline (tens of ceremonies per tenant
 * per day at peak). Deterministic jobId in the scheduler dedupes
 * concurrent enqueues, this is defense in depth.
 */
@Processor(QUEUE_CONTRACT_REMINDER, {
  concurrency: 1,
  lockDuration: 120_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class ContractReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ContractReminderProcessor.name);

  constructor(private readonly sweeper: ContractSweeperService) {
    super();
  }

  async process(job: Job<ReminderSweepPayload>): Promise<void> {
    if (job.name !== 'reminder-sweep') {
      this.logger.warn(`Unknown job name on ${QUEUE_CONTRACT_REMINDER}: ${job.name}`);
      return;
    }
    const { stamp } = job.data;
    const r = await this.sweeper.sweepRemindersForAllTenants();
    this.logger.log(
      `contract-reminder sweep stamp=${stamp} tenants=${r.tenants} reminders=${r.reminders}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `contract-reminder job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`,
    );
  }
}
