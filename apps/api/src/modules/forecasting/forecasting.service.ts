import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  GetForecastQueryDto,
  GetTeamForecastQueryDto,
  SetQuotaDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface UserForecastRow {
  userId: string;
  displayName: string;
  dealsOpen: number;
  pipeline: number;  // weighted: sum(value * probability / 100)
  commit: number;    // sum(value) where probability >= 70
  bestCase: number;  // sum(value) all open deals
  quota: number | null;
  currency: string;
}

export interface ForecastResult {
  year: number;
  period: number;
  periodType: string;
  teamPipeline: number;
  teamCommit: number;
  teamBestCase: number;
  teamQuota: number | null;
  rows: UserForecastRow[];
  currency: string;
}

@Injectable()
export class ForecastingService {
  constructor(private readonly prisma: PrismaService) {}

  async setQuota(dto: SetQuotaDto): Promise<{ updated: boolean }> {
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.forecastQuota.upsert({
        where: {
          tenantId_userId_year_period_periodType: {
            tenantId: ctx.tenantId,
            userId: dto.userId,
            year: dto.year,
            period: dto.period,
            periodType: dto.periodType ?? 'MONTHLY',
          },
        },
        create: {
          tenantId: ctx.tenantId,
          userId: dto.userId,
          year: dto.year,
          period: dto.period,
          periodType: dto.periodType ?? 'MONTHLY',
          quota: new Prisma.Decimal(dto.quota),
          currency: dto.currency ?? 'RON',
        },
        update: {
          quota: new Prisma.Decimal(dto.quota),
          currency: dto.currency ?? 'RON',
        },
      }),
    );
    return { updated: true };
  }

  async getForecast(q: GetForecastQueryDto): Promise<ForecastResult> {
    const ctx = requireTenantContext();
    const { year, period, periodType } = q;

    // Build date range for the period
    const { startDate, endDate } = periodBounds(year, period, periodType ?? 'MONTHLY');

    // All open deals closing within the period
    const deals = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: 'OPEN',
          expectedCloseAt: { gte: startDate, lte: endDate },
        },
        select: { ownerId: true, value: true, probability: true, stage: { select: { probability: true } } },
      }),
    );

    // Quotas for this period
    const quotas = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.forecastQuota.findMany({
        where: {
          tenantId: ctx.tenantId,
          year,
          period,
          periodType: periodType ?? 'MONTHLY',
        },
      }),
    );
    const quotaMap = new Map(quotas.map((q) => [q.userId, q]));

    // Aggregate per owner
    const ownerMap = new Map<string, { dealsOpen: number; pipeline: number; commit: number; bestCase: number }>();
    for (const deal of deals) {
      const ownerId = deal.ownerId ?? '__unassigned__';
      const val = Number(deal.value ?? 0);
      const prob = deal.probability ?? deal.stage.probability ?? 50;
      const existing = ownerMap.get(ownerId) ?? { dealsOpen: 0, pipeline: 0, commit: 0, bestCase: 0 };
      existing.dealsOpen += 1;
      existing.pipeline += (val * prob) / 100;
      if (prob >= 70) existing.commit += val;
      existing.bestCase += val;
      ownerMap.set(ownerId, existing);
    }

    // Build rows (include users that have a quota even if no deals)
    for (const [userId] of quotaMap) {
      if (!ownerMap.has(userId)) {
        ownerMap.set(userId, { dealsOpen: 0, pipeline: 0, commit: 0, bestCase: 0 });
      }
    }

    const rows: UserForecastRow[] = [...ownerMap.entries()].map(([userId, agg]) => {
      const q = quotaMap.get(userId);
      return {
        userId,
        displayName: userId,
        dealsOpen: agg.dealsOpen,
        pipeline: Math.round(agg.pipeline * 100) / 100,
        commit: Math.round(agg.commit * 100) / 100,
        bestCase: Math.round(agg.bestCase * 100) / 100,
        quota: q ? Number(q.quota) : null,
        currency: q?.currency ?? 'RON',
      };
    });

    const teamPipeline = rows.reduce((s, r) => s + r.pipeline, 0);
    const teamCommit = rows.reduce((s, r) => s + r.commit, 0);
    const teamBestCase = rows.reduce((s, r) => s + r.bestCase, 0);
    const teamQuotaRows = rows.filter((r) => r.quota !== null);
    const teamQuota = teamQuotaRows.length > 0
      ? teamQuotaRows.reduce((s, r) => s + (r.quota ?? 0), 0)
      : null;

    return {
      year,
      period,
      periodType: periodType ?? 'MONTHLY',
      teamPipeline: Math.round(teamPipeline * 100) / 100,
      teamCommit: Math.round(teamCommit * 100) / 100,
      teamBestCase: Math.round(teamBestCase * 100) / 100,
      teamQuota,
      rows,
      currency: 'RON',
    };
  }

  async getTeamForecast(q: GetTeamForecastQueryDto): Promise<ForecastResult> {
    return this.getForecast(q);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function periodBounds(
  year: number,
  period: number,
  periodType: string,
): { startDate: Date; endDate: Date } {
  if (periodType === 'QUARTERLY') {
    const month = (period - 1) * 3; // 0-indexed month
    const startDate = new Date(Date.UTC(year, month, 1));
    const endDate = new Date(Date.UTC(year, month + 3, 0, 23, 59, 59, 999));
    return { startDate, endDate };
  }
  // MONTHLY
  const startDate = new Date(Date.UTC(year, period - 1, 1));
  const endDate = new Date(Date.UTC(year, period, 0, 23, 59, 59, 999));
  return { startDate, endDate };
}
