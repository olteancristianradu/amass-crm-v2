import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerSubscription, Prisma } from '@prisma/client';
import {
  CreateCustomerSubscriptionDto,
  ListCustomerSubscriptionsQueryDto,
  UpdateCustomerSubscriptionDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface MrrSnapshot {
  mrr: number;
  arr: number;
  activeCount: number;
  cancelledLast30d: number;
  churnRate: number;
  currency: string;
  byPlan: { plan: string; mrr: number; count: number }[];
}

@Injectable()
export class CustomerSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerSubscriptionDto): Promise<CustomerSubscription> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.customerSubscription.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: dto.companyId,
          name: dto.name,
          plan: dto.plan ?? null,
          mrr: new Prisma.Decimal(dto.mrr),
          currency: dto.currency,
          startDate: dto.startDate,
          endDate: dto.endDate ?? null,
        },
      }),
    );
  }

  async findAll(q: ListCustomerSubscriptionsQueryDto): Promise<CursorPage<CustomerSubscription>> {
    const ctx = requireTenantContext();
    const where: Prisma.CustomerSubscriptionWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.customerSubscription.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<CustomerSubscription> {
    const ctx = requireTenantContext();
    const s = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.customerSubscription.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!s) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Customer subscription not found',
      });
    }
    return s;
  }

  async update(id: string, dto: UpdateCustomerSubscriptionDto): Promise<CustomerSubscription> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.CustomerSubscriptionUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.plan !== undefined ? { plan: dto.plan } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.mrr !== undefined ? { mrr: new Prisma.Decimal(dto.mrr) } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      // When moving to CANCELLED, stamp cancelledAt for churn calculations.
      ...(dto.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.customerSubscription.update({ where: { id }, data }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.customerSubscription.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  /**
   * Aggregate MRR/ARR/churn snapshot used on the Subscriptions dashboard.
   * MRR = sum of ACTIVE subscriptions' mrr (in RON for now — mixed-currency
   * support will need an FX table).
   */
  async snapshot(): Promise<MrrSnapshot> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const active = await tx.customerSubscription.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
        select: { mrr: true, plan: true, currency: true },
      });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const cancelled = await tx.customerSubscription.count({
        where: {
          tenantId: ctx.tenantId,
          status: 'CANCELLED',
          cancelledAt: { gte: thirtyDaysAgo },
        },
      });
      const mrr = active.reduce((sum, s) => sum + Number(s.mrr), 0);
      const activeCount = active.length;
      // Churn rate: cancelled-in-30d / (active at start of period ≈ active + cancelled).
      const denom = activeCount + cancelled;
      const churnRate = denom === 0 ? 0 : cancelled / denom;
      const planMap = new Map<string, { mrr: number; count: number }>();
      for (const s of active) {
        const key = s.plan ?? 'default';
        const agg = planMap.get(key) ?? { mrr: 0, count: 0 };
        agg.mrr += Number(s.mrr);
        agg.count += 1;
        planMap.set(key, agg);
      }
      const byPlan = Array.from(planMap.entries()).map(([plan, v]) => ({ plan, ...v }));
      return {
        mrr,
        arr: mrr * 12,
        activeCount,
        cancelledLast30d: cancelled,
        churnRate,
        currency: active[0]?.currency ?? 'RON',
        byPlan,
      };
    });
  }
}
