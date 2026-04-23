import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ImportJob, ImportType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { QUEUE_IMPORT } from '../../infra/queue/queue.constants';

/**
 * Payload pushed onto the BullMQ `import` queue. The processor consumes
 * this exact shape — keep `storageKey` here in sync with the column name
 * in the ImportJob model so we can never run an import job that points
 * at a stale local path.
 */
export interface ImportJobPayload {
  jobId: string;
  tenantId: string;
  userId?: string;
  type: ImportType;
  storageKey: string;
}

@Injectable()
export class ImporterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_IMPORT) private readonly queue: Queue<ImportJobPayload>,
  ) {}

  /**
   * Upload the CSV bytes to MinIO, persist the ImportJob row (status
   * PENDING), then enqueue a BullMQ job. The processor will fetch the
   * file from MinIO and parse it.
   *
   * Why upload BEFORE creating the row: if MinIO is down we want the
   * caller to see a 5xx immediately rather than create a "pending forever"
   * job that points at a non-existent object.
   *
   * Storage key layout: `<tenantId>/imports/<uuid>-<sanitised-fileName>`
   *   - tenantId prefix gives us key-level tenant isolation in MinIO
   *   - uuid prevents collisions when the same file is uploaded twice
   *   - sanitised filename is human-readable for debugging
   */
  async enqueue(args: {
    type: ImportType;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<ImportJob> {
    const ctx = requireTenantContext();
    const safeName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const storageKey = `${ctx.tenantId}/imports/${randomUUID()}-${safeName}`;

    // Upload first — fail fast if storage is unavailable.
    await this.storage.putObject(storageKey, args.buffer, args.mimeType);

    const job = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.importJob.create({
        data: {
          tenantId: ctx.tenantId,
          type: args.type,
          fileName: args.fileName,
          storageKey,
          createdById: ctx.userId,
        },
      }),
    );

    // Fair-queue defence: if this tenant already has N+ jobs queued, push
    // new ones to a lower priority so a tenant bulk-uploading 100 CSVs
    // cannot starve others. BullMQ priority: LOWER = runs first.
    const tenantQueueDepth = await this.queue.getJobCounts('waiting', 'active');
    const perTenantPending = await this.queue
      .getJobs(['waiting', 'active'])
      .then((jobs) => jobs.filter((j) => j.data?.tenantId === ctx.tenantId).length)
      .catch(() => 0);
    const priority = perTenantPending > 5 || tenantQueueDepth.active > 20 ? 10 : 1;

    await this.queue.add(
      'process',
      {
        jobId: job.id,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        type: args.type,
        storageKey,
      },
      {
        // Idempotent on jobId so accidental double-enqueues collapse.
        jobId: job.id,
        priority,
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
