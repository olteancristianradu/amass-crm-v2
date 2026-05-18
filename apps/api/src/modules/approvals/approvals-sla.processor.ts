import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_APPROVAL_SLA } from '../../infra/queue/queue.constants';
import { ApprovalsService } from './approvals.service';

interface ApprovalSlaPayload {
  /** YYYYMMDDHHMM bucket in Europe/Bucharest — just for log readability. */
  stamp: string;
}

/**
 * Phase 2 F2 — BullMQ consumer for the approval-sla queue. Iterates all
 * tenants, sweeping requests whose `expiresAt` (or current step's
 * `expiresAt`) has passed without a decision. Each transition is committed
 * inside its own per-request `runWithTenant` so a slow tenant cannot
 * starve the rest.
 *
 * Concurrency: 1 — there's only ever one sweep at a time, and the cron
 * dedup jobId already prevents concurrent enqueues; serial worker = defense
 * in depth.
 */
@Processor(QUEUE_APPROVAL_SLA, {
  concurrency: 1,
  lockDuration: 120_000, // generous; sweep is bounded but iterates tenants
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class ApprovalsSlaProcessor extends WorkerHost {
  private readonly logger = new Logger(ApprovalsSlaProcessor.name);

  constructor(private readonly approvals: ApprovalsService) {
    super();
  }

  async process(job: Job<ApprovalSlaPayload>): Promise<void> {
    if (job.name !== 'sla-sweep') {
      this.logger.warn(`Unknown job name on ${QUEUE_APPROVAL_SLA}: ${job.name}`);
      return;
    }
    const { stamp } = job.data;
    const { tenants, expired } = await this.approvals.expireOverdueForAllTenants();
    this.logger.log(
      `approval-sla sweep stamp=${stamp} tenants=${tenants} expired=${expired}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `approval-sla job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`,
    );
  }
}
