import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_CONTRACT_EXPIRE } from '../../../infra/queue/queue.constants';
import { ContractSweeperService } from '../services/contract-sweeper.service';

interface ExpireSweepPayload {
  stamp: string;
}

/**
 * Phase 2 F1 — BullMQ consumer for the contract-expire queue. Walks
 * overdue signers, flips them to EXPIRED, and if all signers for a
 * contract are now terminal-without-SIGNED, cascades the parent contract
 * to DECLINED + emits CONTRACT_EXPIRED.
 */
@Processor(QUEUE_CONTRACT_EXPIRE, {
  concurrency: 1,
  lockDuration: 120_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class ContractExpireProcessor extends WorkerHost {
  private readonly logger = new Logger(ContractExpireProcessor.name);

  constructor(private readonly sweeper: ContractSweeperService) {
    super();
  }

  async process(job: Job<ExpireSweepPayload>): Promise<void> {
    if (job.name !== 'expire-sweep') {
      this.logger.warn(`Unknown job name on ${QUEUE_CONTRACT_EXPIRE}: ${job.name}`);
      return;
    }
    const { stamp } = job.data;
    const r = await this.sweeper.sweepExpiriesForAllTenants();
    this.logger.log(
      `contract-expire sweep stamp=${stamp} tenants=${r.tenants} signers=${r.expired} contracts=${r.contracts}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `contract-expire job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`,
    );
  }
}
