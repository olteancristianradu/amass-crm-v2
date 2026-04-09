import { Injectable, NotFoundException } from '@nestjs/common';
import { Pipeline, PipelineStage } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStage[];
}

/**
 * PipelinesService — read-only CRUD surface for S10. Admin UI to create /
 * rename pipelines lands in a later sprint; for now the only write path is
 * the default-pipeline seed inside AuthService.register(). We still expose
 * `findOne` and `listAll` because the Deals kanban needs to know the
 * stage list to render its columns.
 */
@Injectable()
export class PipelinesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<PipelineWithStages[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.pipeline.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
        include: {
          stages: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
    );
  }

  async findOne(id: string): Promise<PipelineWithStages> {
    const ctx = requireTenantContext();
    const pipeline = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.pipeline.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: {
          stages: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
    );
    if (!pipeline) {
      throw new NotFoundException({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found' });
    }
    return pipeline;
  }

  /**
   * Convenience lookup used by DealsService when a create request omits
   * `pipelineId` — we default to the tenant's `isDefault` pipeline. If no
   * default exists (shouldn't happen post-seed but defend anyway), fall
   * back to the first pipeline by order.
   */
  async getDefault(): Promise<PipelineWithStages> {
    const ctx = requireTenantContext();
    const pipeline = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.pipeline.findFirst({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
        include: {
          stages: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
    );
    if (!pipeline) {
      throw new NotFoundException({
        code: 'PIPELINE_NOT_FOUND',
        message: 'No pipeline configured for this tenant',
      });
    }
    return pipeline;
  }

  /**
   * Resolve a stage inside a pipeline. Used by DealsService when moving a
   * deal between stages (need the stage's `type` to compute deal `status`).
   */
  async findStage(pipelineId: string, stageId: string): Promise<PipelineStage> {
    const ctx = requireTenantContext();
    const stage = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.pipelineStage.findFirst({
        where: {
          id: stageId,
          pipelineId,
          tenantId: ctx.tenantId,
          deletedAt: null,
        },
      }),
    );
    if (!stage) {
      throw new NotFoundException({ code: 'STAGE_NOT_FOUND', message: 'Stage not found' });
    }
    return stage;
  }
}
