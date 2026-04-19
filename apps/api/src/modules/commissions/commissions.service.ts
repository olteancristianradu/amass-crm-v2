import { Injectable, NotFoundException } from '@nestjs/common';
import { Commission, CommissionPlan, Prisma } from '@prisma/client';
import {
  ComputeCommissionsDto,
  CreateCommissionPlanDto,
  UpdateCommissionPlanDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(dto: CreateCommissionPlanDto): Promise<CommissionPlan> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commissionPlan.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          percent: new Prisma.Decimal(dto.percent),
          isActive: dto.isActive,
        },
      }),
    );
  }

  async listPlans(): Promise<CommissionPlan[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commissionPlan.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async getPlan(id: string): Promise<CommissionPlan> {
    const ctx = requireTenantContext();
    const p = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commissionPlan.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!p) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Commission plan not found' });
    return p;
  }

  async updatePlan(id: string, dto: UpdateCommissionPlanDto): Promise<CommissionPlan> {
    await this.getPlan(id);
    const ctx = requireTenantContext();
    const data: Prisma.CommissionPlanUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.percent !== undefined ? { percent: new Prisma.Decimal(dto.percent) } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commissionPlan.update({ where: { id }, data }),
    );
  }

  async deletePlan(id: string): Promise<void> {
    await this.getPlan(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commissionPlan.delete({ where: { id } }),
    );
  }

  /**
   * Walk WON deals closed in the (year, month) bucket, group by owner,
   * multiply sum by the plan percent, and upsert a Commission row per user.
   * Safe to re-run — recomputes from scratch each invocation.
   */
  async compute(dto: ComputeCommissionsDto): Promise<Commission[]> {
    const ctx = requireTenantContext();
    const plan = await this.getPlan(dto.planId);
    const percent = Number(plan.percent) / 100;
    const start = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const end = new Date(Date.UTC(dto.year, dto.month, 1));

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const deals = await tx.deal.findMany({
        where: {
          tenantId: ctx.tenantId,
          status: 'WON',
          closedAt: { gte: start, lt: end },
          ownerId: { not: null },
        },
        select: { ownerId: true, value: true, currency: true },
      });
      const byOwner = new Map<string, { basis: number; count: number; currency: string }>();
      for (const d of deals) {
        if (!d.ownerId) continue;
        const entry = byOwner.get(d.ownerId) ?? { basis: 0, count: 0, currency: d.currency };
        entry.basis += Number(d.value ?? 0);
        entry.count += 1;
        byOwner.set(d.ownerId, entry);
      }
      const out: Commission[] = [];
      for (const [userId, agg] of byOwner.entries()) {
        const amount = agg.basis * percent;
        const row = await tx.commission.upsert({
          where: {
            tenantId_userId_year_month: {
              tenantId: ctx.tenantId,
              userId,
              year: dto.year,
              month: dto.month,
            },
          },
          create: {
            tenantId: ctx.tenantId,
            userId,
            planId: plan.id,
            year: dto.year,
            month: dto.month,
            dealsCount: agg.count,
            basis: new Prisma.Decimal(agg.basis),
            amount: new Prisma.Decimal(amount),
            currency: agg.currency,
          },
          update: {
            planId: plan.id,
            dealsCount: agg.count,
            basis: new Prisma.Decimal(agg.basis),
            amount: new Prisma.Decimal(amount),
            currency: agg.currency,
          },
        });
        out.push(row);
      }
      return out;
    });
  }

  async list(year?: number, month?: number): Promise<Commission[]> {
    const ctx = requireTenantContext();
    const where: Prisma.CommissionWhereInput = {
      tenantId: ctx.tenantId,
      ...(year !== undefined ? { year } : {}),
      ...(month !== undefined ? { month } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commission.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }, { amount: 'desc' }] }),
    );
  }

  async markPaid(id: string, paidAt: Date): Promise<Commission> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.commission.update({ where: { id }, data: { paidAt } }),
    );
  }
}
