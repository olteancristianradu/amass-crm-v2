import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LeadScoringService, LeadEntityType } from './lead-scoring.service';

interface RecomputeSinglePayload {
  tenantId: string;
  entityType: LeadEntityType;
  entityId: string;
}

@Processor('lead-scoring')
export class LeadScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadScoringProcessor.name);

  constructor(private readonly svc: LeadScoringService) { super(); }

  async process(job: Job): Promise<void> {
    if (job.name === 'recompute-single') {
      const { tenantId, entityType, entityId } = job.data as RecomputeSinglePayload;
      await this.svc.computeAndSave(tenantId, entityType, entityId);
      return;
    }
    if (job.name === 'recompute-tenant') {
      const { tenantId } = job.data as { tenantId: string };
      const count = await this.svc.recomputeAllForTenant(tenantId);
      this.logger.log(`Recomputed ${count} scores for tenant ${tenantId}`);
      return;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Lead scoring job ${job.id} failed: ${err.message}`);
  }
}
