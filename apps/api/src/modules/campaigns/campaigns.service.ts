import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Campaign, Prisma } from '@prisma/client';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  UpdateCampaignDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transitions a DRAFT or PAUSED campaign into ACTIVE.
   * Called from the API directly or from the workflow engine's SEND_CAMPAIGN
   * action. Idempotent for ACTIVE state. Throws if campaign missing or
   * already COMPLETED (terminal).
   */
  async launch(campaignId: string, tenantId: string): Promise<Campaign> {
    const existing = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' });
    }
    if (existing.status === 'COMPLETED') {
      this.logger.warn('Cannot launch completed campaign %s', campaignId);
      return existing;
    }
    if (existing.status === 'ACTIVE') return existing;
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE', startDate: existing.startDate ?? new Date() },
    });
  }

  async create(dto: CreateCampaignDto): Promise<Campaign> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          channel: dto.channel,
          segmentId: dto.segmentId ?? null,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
          budget: dto.budget ? new Prisma.Decimal(dto.budget) : null,
          currency: dto.currency,
          targetCount: dto.targetCount,
          createdById: ctx.userId ?? null,
        },
      }),
    );
  }

  async findAll(q: ListCampaignsQueryDto): Promise<CursorPage<Campaign>> {
    const ctx = requireTenantContext();
    const where: Prisma.CampaignWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Campaign> {
    const ctx = requireTenantContext();
    const c = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!c) {
      throw new NotFoundException({ code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' });
    }
    return c;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.CampaignUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
      ...(dto.segmentId !== undefined ? { segmentId: dto.segmentId } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.budget !== undefined ? { budget: dto.budget ? new Prisma.Decimal(dto.budget) : null } : {}),
      ...(dto.targetCount !== undefined ? { targetCount: dto.targetCount } : {}),
      ...(dto.sentCount !== undefined ? { sentCount: dto.sentCount } : {}),
      ...(dto.conversions !== undefined ? { conversions: dto.conversions } : {}),
      ...(dto.revenue !== undefined ? { revenue: new Prisma.Decimal(dto.revenue) } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({ where: { id }, data }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}
