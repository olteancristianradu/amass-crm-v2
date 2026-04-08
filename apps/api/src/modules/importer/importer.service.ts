import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ImportJob, ImportType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { QUEUE_IMPORT } from '../../infra/queue/queue.constants';

export interface ImportJobPayload {
  jobId: string;
  tenantId: string;
  userId?: string;
  type: ImportType;
  filePath: string;
}

@Injectable()
export class ImporterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_IMPORT) private readonly queue: Queue<ImportJobPayload>,
  ) {}

  /**
   * Persist the ImportJob row (status PENDING) and enqueue a BullMQ job.
   * The processor will pick it up and stream-parse the file.
   */
  async enqueue(args: {
    type: ImportType;
    fileName: string;
    filePath: string;
  }): Promise<ImportJob> {
    const ctx = requireTenantContext();
    const job = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.importJob.create({
        data: {
          tenantId: ctx.tenantId,
          type: args.type,
          fileName: args.fileName,
          filePath: args.filePath,
          createdById: ctx.userId,
        },
      }),
    );

    await this.queue.add(
      'process',
      {
        jobId: job.id,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        type: args.type,
        filePath: args.filePath,
      },
      {
        // Idempotent on jobId so accidental double-enqueues collapse.
        jobId: job.id,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
        attempts: 1,
      },
    );

    await this.audit.log({
      action: 'import.create',
      subjectType: 'import_job',
      subjectId: job.id,
      metadata: { type: args.type, fileName: args.fileName },
    });

    return job;
  }

  async findOne(id: string): Promise<ImportJob> {
    const ctx = requireTenantContext();
    const job = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.importJob.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!job) {
      throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import job not found' });
    }
    return job;
  }

  async list(limit: number): Promise<ImportJob[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.importJob.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    );
  }
}
