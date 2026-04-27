import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { ReportsService } from './reports.service';

function build(queryQueue: unknown[][]) {
  const tx = { $queryRaw: vi.fn(async () => queryQueue.shift() ?? []) };
  const prisma = {
    runWithTenant: vi.fn(
      async (
        _id: string,
        _level: string,
        fn: (t: typeof tx) => Promise<unknown>,
      ) => fn(tx),
    ),
  } as unknown as ConstructorParameters<typeof ReportsService>[0];
  const svc = new ReportsService(prisma);
  return { svc, prisma, tx };
}

describe('ReportsService.dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates 5 query results into a single payload', async () => {
    const h = build([
      // dealStats
      [{ total: 10n, open: 4n, won: 5n, lost: 1n, total_value: '15000.50', won_value: '12000.00' }],
      // pipeline
      [
        { stageId: 's-1', stageName: 'Discovery', count: 4n, totalValue: '5000' },
        { stageId: 's-2', stageName: 'Closing', count: 6n, totalValue: '10000' },
      ],
      // activities
      [
        { action: 'company.created', count: 30n },
        { action: 'deal.created', count: 10n },
      ],
      // emails
      [
        { status: 'SENT', count: 100n },
        { status: 'FAILED', count: 5n },
        { status: 'QUEUED', count: 3n },
        { status: 'SENDING', count: 2n },
      ],
      // calls
      [{ total: 50n, completed: 45n, total_duration: 9000n }],
    ]);
    const out = await h.svc.dashboard('2026-04-01', '2026-04-30');
    expect(out.deals.total).toBe(10);
    expect(out.deals.avgDealValue).toBe(15000.5 / 10);
    expect(out.pipeline).toHaveLength(2);
    expect(out.activities.total).toBe(40);
    expect(out.activities.byType[0]).toEqual({ type: 'company.created', count: 30 });
    expect(out.emails.queued).toBe(5); // QUEUED + SENDING
    expect(out.emails.sent).toBe(100);
    expect(out.emails.failed).toBe(5);
    expect(out.calls.avgDurationSec).toBe(9000 / 45);
    expect(out.period).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('handles empty deal stats with avgDealValue=0 and null sums coerced to 0', async () => {
    const h = build([
      [{ total: 0n, open: 0n, won: 0n, lost: 0n, total_value: null, won_value: null }],
      [],
      [],
      [],
      [{ total: 0n, completed: 0n, total_duration: null }],
    ]);
    const out = await h.svc.dashboard('2026-04-01', '2026-04-30');
    expect(out.deals.totalValue).toBe(0);
    expect(out.deals.avgDealValue).toBe(0);
    expect(out.calls.avgDurationSec).toBe(0);
    expect(out.activities.total).toBe(0);
    expect(out.activities.byType).toEqual([]);
  });
});

describe('ReportsService.financialSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('groups by currency + computes outstanding = issued − paid (clamped at 0)', async () => {
    const h = build([
      [
        {
          currency: 'RON',
          issued_total: '10000',
          overdue_total: '500',
          paid_total: '7500',
          issued_count: 12n,
          overdue_count: 1n,
          paid_count: 8n,
        },
        {
          // Edge case: paid > issued (e.g. credit note) → outstanding clamped to 0.
          currency: 'EUR',
          issued_total: '500',
          overdue_total: null,
          paid_total: '600',
          issued_count: 3n,
          overdue_count: 0n,
          paid_count: 3n,
        },
      ],
    ]);
    const out = await h.svc.financialSummary('2026-04-01', '2026-04-30');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      currency: 'RON',
      issued: 10000,
      overdue: 500,
      paid: 7500,
      outstanding: 2500,
      issuedCount: 12,
      paidCount: 8,
    });
    expect(out[1].outstanding).toBe(0);
    expect(out[1].overdue).toBe(0); // null coerced
  });
});

describe('ReportsService.revenueTrend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('formats month as YYYY-MM-DD and parses revenue float', async () => {
    const h = build([
      [
        { month: new Date('2026-04-01T00:00:00Z'), currency: 'RON', revenue: '5000.5' },
        { month: new Date('2026-05-01T00:00:00Z'), currency: 'RON', revenue: null },
      ],
    ]);
    const out = await h.svc.revenueTrend('2026-04-01', '2026-05-31');
    expect(out[0]).toEqual({ month: '2026-04-01', currency: 'RON', revenue: 5000.5 });
    expect(out[1].revenue).toBe(0); // null → 0
  });
});

describe('ReportsService.dealsTrend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults groupBy to week and parses bigint counts', async () => {
    const h = build([
      [
        { period: new Date('2026-04-07T00:00:00Z'), created: 5n, won: 2n, revenue: '3000' },
      ],
    ]);
    const out = await h.svc.dealsTrend('2026-04-01', '2026-04-30');
    expect(out[0]).toEqual({
      period: '2026-04-07',
      created: 5,
      won: 2,
      revenue: 3000,
    });
  });

  it('accepts groupBy=month explicitly', async () => {
    const h = build([
      [{ period: new Date('2026-04-01T00:00:00Z'), created: 12n, won: 4n, revenue: null }],
    ]);
    const out = await h.svc.dealsTrend('2026-01-01', '2026-12-31', 'month');
    expect(out[0].revenue).toBe(0);
    expect(out[0].created).toBe(12);
  });
});
