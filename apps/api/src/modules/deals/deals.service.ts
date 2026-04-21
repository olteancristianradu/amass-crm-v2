import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Deal, Prisma } from '@prisma/client';
import {
  CreateDealDto,
  ListDealsQueryDto,
  MoveDealDto,
  UpdateDealDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { PipelinesService } from '../pipelines/pipelines.service';
import { ProjectsService } from '../projects/projects.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { CursorPage, makeCursorPage } from '../../common/pagination';
import { aggregateForecast, stageTypeToStatus } from './deals.helpers';

/**
 * DealsService — the core of the S10 kanban. Four things it has to get right:
 *
 *   1. tenant isolation — every query via runWithTenant, every where clause
 *      pins tenantId even though RLS would catch omissions.
 *
 *   2. stage ↔ status coherence — a deal's `status` is derived from its
 *      stage's `type` (OPEN/WON/LOST). We compute and persist it on every
 *      create + move so the FE can filter "open deals" without joining
 *      stages. `closedAt` is set when moving into a WON/LOST stage and
 *      cleared on re-open.
 *
 *   3. stage ↔ pipeline coherence — you cannot move a deal to a stage in
 *      a different pipeline. The service checks this explicitly and
 *      returns 400 STAGE_PIPELINE_MISMATCH.
 *
 *   4. orderInStage — we store an integer with gaps. On create we take
 *      `max(orderInStage) + 10` in the target stage. On move with an
 *      explicit `orderInStage`, we trust the FE to pick a reasonable value
 *      (Kanban DnD lands in a later sprint). On move without an explicit
 *      value, we again append with max + 10. Re-packing happens nowhere
 *      in S10 — cheaper and fewer write locks.
 */
@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly pipelines: PipelinesService,
    private readonly workflows: WorkflowsService,
    private readonly projects: ProjectsService,
  ) {}

  async create(dto: CreateDealDto): Promise<Deal> {
    const ctx = requireTenantContext();
    const stage = await this.pipelines.findStage(dto.pipelineId, dto.stageId);
    const orderInStage = await this.nextOrderInStage(dto.pipelineId, dto.stageId);

    const deal = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.create({
        data: {
          tenantId: ctx.tenantId,
          pipelineId: dto.pipelineId,
          stageId: dto.stageId,
          title: dto.title,
          description: dto.description ?? null,
          value: dto.value !== undefined ? new Prisma.Decimal(dto.value) : null,
          currency: dto.currency,
          probability: dto.probability ?? null,
          expectedCloseAt: dto.expectedCloseAt ?? null,
          companyId: dto.companyId ?? null,
          contactId: dto.contactId ?? null,
          ownerId: dto.ownerId ?? null,
          status: stageTypeToStatus(stage.type),
          closedAt: stage.type === 'OPEN' ? null : new Date(),
          orderInStage,
          createdById: ctx.userId ?? null,
        },
      }),
    );

    await this.audit.log({
      action: 'deal.create',
      subjectType: 'deal',
      subjectId: deal.id,
      metadata: { title: deal.title, pipelineId: deal.pipelineId, stageId: deal.stageId },
    });
    // Timeline activity on the linked company/contact if present — deals
    // themselves are not yet a SubjectType in the polymorphic timeline
    // (would require a migration). So we log against the linked subject.
    if (deal.companyId) {
      await this.activities.log({
        subjectType: 'COMPANY',
        subjectId: deal.companyId,
        action: 'deal.created',
        metadata: { dealId: deal.id, title: deal.title },
      });
    } else if (deal.contactId) {
      await this.activities.log({
        subjectType: 'CONTACT',
        subjectId: deal.contactId,
        action: 'deal.created',
        metadata: { dealId: deal.id, title: deal.title },
      });
    }
    // Fire-and-forget workflow trigger
    void this.workflows.trigger({
      trigger: 'DEAL_CREATED',
      subjectType: 'DEAL',
      subjectId: deal.id,
      tenantId: ctx.tenantId,
    });
    return deal;
  }

  async list(q: ListDealsQueryDto): Promise<CursorPage<Deal>> {
    const ctx = requireTenantContext();
    const where: Prisma.DealWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.contactId ? { contactId: q.contactId } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { description: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // We sort by orderInStage asc so the kanban column layout is stable,
    // then by id for tie-breaking. This deliberately differs from the
    // generic `createdAt desc` pattern used elsewhere — the kanban cares
    // about column order, not recency.
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [
          { stageId: 'asc' },
          { orderInStage: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Deal> {
    const ctx = requireTenantContext();
    const deal = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!deal) throw new NotFoundException({ code: 'DEAL_NOT_FOUND', message: 'Deal not found' });
    return deal;
  }

  async update(id: string, dto: UpdateDealDto): Promise<Deal> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();

    // Translate nullable string value → Decimal | null explicitly so Prisma
    // stores the right thing. Without this, passing value: "0" as a string
    // would throw a runtime mismatch error.
    const data: Prisma.DealUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.value !== undefined
        ? { value: dto.value === null ? null : new Prisma.Decimal(dto.value) }
        : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.probability !== undefined ? { probability: dto.probability } : {}),
      ...(dto.expectedCloseAt !== undefined ? { expectedCloseAt: dto.expectedCloseAt } : {}),
      ...(dto.companyId !== undefined ? { companyId: dto.companyId } : {}),
      ...(dto.contactId !== undefined ? { contactId: dto.contactId } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
      ...(dto.lostReason !== undefined ? { lostReason: dto.lostReason } : {}),
    };

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.update({ where: { id }, data }),
    );

    await this.audit.log({
      action: 'deal.update',
      subjectType: 'deal',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    if (existing.companyId) {
      await this.activities.log({
        subjectType: 'COMPANY',
        subjectId: existing.companyId,
        action: 'deal.updated',
        metadata: { dealId: id, fields: Object.keys(dto) },
      });
    }
    return updated;
  }

  /**
   * Move a deal to a new stage (and possibly a new position within that
   * column). Recomputes `status`, `closedAt`, `orderInStage` atomically.
   *
   *  - STAGE_PIPELINE_MISMATCH if the target stage belongs to a different
   *    pipeline than the deal (cross-pipeline moves not supported in S10).
   *  - LOST_REASON_REQUIRED if the target stage type is LOST and no
   *    lostReason was provided.
   *  - Idempotent-ish: moving to the same stage with no orderInStage is
   *    allowed and simply no-ops the stage change (still touches closedAt
   *    to allow "reopen to same column", which the FE doesn't use but is
   *    cheap to support).
   */
  async move(id: string, dto: MoveDealDto): Promise<Deal> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    const targetStage = await this.pipelines.findStage(existing.pipelineId, dto.stageId);

    if (targetStage.type === 'LOST' && !dto.lostReason) {
      throw new BadRequestException({
        code: 'LOST_REASON_REQUIRED',
        message: 'A reason is required when moving a deal to a Lost stage',
      });
    }

    const newStatus = stageTypeToStatus(targetStage.type);
    const closedAt = targetStage.type === 'OPEN' ? null : existing.closedAt ?? new Date();
    const orderInStage =
      dto.orderInStage ?? (await this.nextOrderInStage(existing.pipelineId, dto.stageId));

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.update({
        where: { id },
        data: {
          stageId: dto.stageId,
          status: newStatus,
          closedAt,
          orderInStage,
          ...(dto.lostReason !== undefined ? { lostReason: dto.lostReason } : {}),
        },
      }),
    );

    await this.audit.log({
      action: 'deal.move',
      subjectType: 'deal',
      subjectId: id,
      metadata: {
        fromStageId: existing.stageId,
        toStageId: dto.stageId,
        status: newStatus,
      },
    });
    if (existing.companyId) {
      await this.activities.log({
        subjectType: 'COMPANY',
        subjectId: existing.companyId,
        action: `deal.${newStatus.toLowerCase()}`,
        metadata: {
          dealId: id,
          fromStageId: existing.stageId,
          toStageId: dto.stageId,
          stageName: targetStage.name,
        },
      });
    }
    // Fire-and-forget workflow trigger for stage change
    void this.workflows.trigger({
      trigger: 'DEAL_STAGE_CHANGED',
      subjectType: 'DEAL',
      subjectId: updated.id,
      tenantId: ctx.tenantId,
      stageId: dto.stageId,
    });
    // S23: auto-spin a Project when a deal lands in a WON stage. Idempotent
    // (ProjectsService.createFromDeal short-circuits if dealId already has
    // a project). Awaited so tests and audit trail are deterministic.
    if (targetStage.type === 'WON') {
      try {
        await this.projects.createFromDeal(updated.id);
      } catch (err) {
        // Never block deal-move on project creation failure.
        this.logger.error(
          'deal→project auto-creation failed',
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'deal.delete',
      subjectType: 'deal',
      subjectId: id,
      metadata: { title: existing.title },
    });
    if (existing.companyId) {
      await this.activities.log({
        subjectType: 'COMPANY',
        subjectId: existing.companyId,
        action: 'deal.deleted',
        metadata: { dealId: id, title: existing.title },
      });
    }
  }

  /**
   * Weighted forecast: all OPEN deals grouped by stage with probability applied.
   * Returns per-stage breakdown + total weighted value for the forecast chart.
   * Probability comes from the deal's own override if set, otherwise from the stage default.
   */
  async forecast(pipelineId?: string) {
    const ctx = requireTenantContext();
    const deals = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.findMany({
        where: {
          tenantId: ctx.tenantId,
          status: 'OPEN',
          deletedAt: null,
          ...(pipelineId ? { pipelineId } : {}),
        },
        include: { stage: { select: { id: true, name: true, probability: true } } },
      }),
    );

    return aggregateForecast(deals);
  }

  /**
   * Compute the next `orderInStage` value for a given (pipeline, stage).
   * Uses max+10 so that manually inserting a deal in the middle of a
   * column is a cheap single-row update rather than a re-pack. Returns 10
   * for an empty column so we keep gaps on every side.
   */
  private async nextOrderInStage(pipelineId: string, stageId: string): Promise<number> {
    const ctx = requireTenantContext();
    const maxRow = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.aggregate({
        where: { tenantId: ctx.tenantId, pipelineId, stageId, deletedAt: null },
        _max: { orderInStage: true },
      }),
    );
    const current = maxRow._max.orderInStage ?? 0;
    return current + 10;
  }
}

