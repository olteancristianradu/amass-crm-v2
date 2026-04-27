import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ForecastingService } from './forecasting.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    deal: { findMany: vi.fn() },
    forecastQuota: { upsert: vi.fn(), findMany: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ForecastingService>[0];
  const svc = new ForecastingService(prisma);
  return { svc, prisma, tx };
}

describe('ForecastingService.setQuota', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts the quota with Decimal-coerced value + tenant scope', async () => {
    const h = build();
    h.tx.forecastQuota.upsert.mockResolvedValueOnce({ id: 'q-1' });
    await h.svc.setQuota({
      userId: 'user-1',
      year: 2026,
      period: 4,
      periodType: 'MONTHLY',
      quota: '50000',
      currency: 'EUR',
    } as never);
    const args = h.tx.forecastQuota.upsert.mock.calls[0][0];
    expect(args.where.tenantId_userId_year_period_periodType).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      year: 2026,
      period: 4,
      periodType: 'MONTHLY',
    });
    expect(args.create.quota).toBeInstanceOf(Prisma.Decimal);
    expect(args.create.quota.toString()).toBe('50000');
    expect(args.update.currency).toBe('EUR');
  });

  it('defaults periodType to MONTHLY and currency to RON', async () => {
    const h = build();
    h.tx.forecastQuota.upsert.mockResolvedValueOnce({ id: 'q-2' });
    await h.svc.setQuota({ userId: 'u', year: 2026, period: 1, quota: '1000' } as never);
    const args = h.tx.forecastQuota.upsert.mock.calls[0][0];
    expect(args.where.tenantId_userId_year_period_periodType.periodType).toBe('MONTHLY');
    expect(args.create.currency).toBe('RON');
  });
});

describe('ForecastingService.getForecast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('weights pipeline by deal probability and falls back to stage probability', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([
      // 1000 * 50/100 = 500 pipeline; commit 0 (50 < 70); best 1000
      { ownerId: 'u-1', value: '1000', probability: 50, stage: { probability: 25 } },
      // 2000 * 80/100 = 1600 pipeline; commit 2000 (80 >= 70); best 2000
      { ownerId: 'u-1', value: '2000', probability: 80, stage: { probability: 25 } },
      // probability null → falls back to stage 90 → 500 * 90/100 = 450 pipeline; commit 500; best 500
      { ownerId: 'u-2', value: '500', probability: null, stage: { probability: 90 } },
    ]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([]);
    const out = await h.svc.getForecast({ year: 2026, period: 4, periodType: 'MONTHLY' } as never);
    const u1 = out.rows.find((r) => r.userId === 'u-1')!;
    const u2 = out.rows.find((r) => r.userId === 'u-2')!;
    expect(u1.dealsOpen).toBe(2);
    expect(u1.pipeline).toBe(2100); // 500 + 1600
    expect(u1.commit).toBe(2000);
    expect(u1.bestCase).toBe(3000);
    expect(u2.pipeline).toBe(450);
    expect(u2.commit).toBe(500);
    expect(out.teamPipeline).toBe(2550);
    expect(out.teamCommit).toBe(2500);
    expect(out.teamBestCase).toBe(3500);
  });

  it('coalesces deals with no owner under __unassigned__', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([
      { ownerId: null, value: '100', probability: 50, stage: { probability: 25 } },
    ]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([]);
    const out = await h.svc.getForecast({ year: 2026, period: 4, periodType: 'MONTHLY' } as never);
    expect(out.rows[0].userId).toBe('__unassigned__');
  });

  it('includes quota-only users (no open deals) in the row set', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([
      { userId: 'u-1', quota: new Prisma.Decimal('5000'), currency: 'RON' },
    ]);
    const out = await h.svc.getForecast({ year: 2026, period: 4, periodType: 'MONTHLY' } as never);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ userId: 'u-1', dealsOpen: 0, pipeline: 0, quota: 5000 });
    expect(out.teamQuota).toBe(5000);
  });

  it('returns teamQuota = null when nobody has a quota', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([
      { ownerId: 'u-1', value: '100', probability: 50, stage: { probability: 25 } },
    ]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([]);
    const out = await h.svc.getForecast({ year: 2026, period: 4, periodType: 'MONTHLY' } as never);
    expect(out.teamQuota).toBeNull();
  });

  it('queries the right month window for MONTHLY periods', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([]);
    await h.svc.getForecast({ year: 2026, period: 4, periodType: 'MONTHLY' } as never);
    const where = h.tx.deal.findMany.mock.calls[0][0].where;
    // April 2026 → 1..30 inclusive
    expect(where.expectedCloseAt.gte.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(where.expectedCloseAt.lte.toISOString()).toBe('2026-04-30T23:59:59.999Z');
  });

  it('queries a 3-month window for QUARTERLY periods (Q2 = Apr-Jun)', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([]);
    await h.svc.getForecast({ year: 2026, period: 2, periodType: 'QUARTERLY' } as never);
    const where = h.tx.deal.findMany.mock.calls[0][0].where;
    expect(where.expectedCloseAt.gte.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(where.expectedCloseAt.lte.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('picks the modal row currency for the team summary (RON wins over EUR 2:1)', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([
      { ownerId: 'u-1', value: '100', probability: 50, stage: { probability: 25 } },
      { ownerId: 'u-2', value: '100', probability: 50, stage: { probability: 25 } },
      { ownerId: 'u-3', value: '100', probability: 50, stage: { probability: 25 } },
    ]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([
      { userId: 'u-1', quota: new Prisma.Decimal(1), currency: 'RON' },
      { userId: 'u-2', quota: new Prisma.Decimal(1), currency: 'RON' },
      { userId: 'u-3', quota: new Prisma.Decimal(1), currency: 'EUR' },
    ]);
    const out = await h.svc.getForecast({ year: 2026, period: 4, periodType: 'MONTHLY' } as never);
    expect(out.currency).toBe('RON');
  });
});

describe('ForecastingService.getTeamForecast', () => {
  it('delegates to getForecast (same shape)', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([]);
    h.tx.forecastQuota.findMany.mockResolvedValueOnce([]);
    const out = await h.svc.getTeamForecast({ year: 2026, period: 4 } as never);
    expect(out).toMatchObject({ year: 2026, period: 4 });
  });
});
