import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExportsService, ExportableEntity } from './exports.service';
import { QUEUE_EXPORT } from '../../infra/queue/queue.constants';

interface ExportJobPayload {
  tenantId: string;
  exportId: string;
  entityType: ExportableEntity;
  filters?: Record<string, unknown>;
}

@Processor(QUEUE_EXPORT)
export class ExportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportsProcessor.name);

  constructor(private readonly svc: ExportsService) { super(); }

  async process(job: Job<ExportJobPayload>): Promise<void> {
    const { tenantId, exportId, entityType, filters } = job.data;
    await this.svc.executeExport(tenantId, exportId, entityType, filters);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Export job ${job.id} failed: ${err.message}`);
  }
}
