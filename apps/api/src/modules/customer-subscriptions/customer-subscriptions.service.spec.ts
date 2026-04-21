import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

const dec = (n: number) => new Prisma.Decimal(n);

describe('CustomerSubscriptionsService.snapshot', () => {
  let svc: CustomerSubscriptionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new CustomerSubscriptionsService(mockPrisma);
  });

  it('returns zeros when tenant has no active subscriptions', async () => {
    mockRunWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({
        customerSubscription: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
      }),
    );

    const snap = await svc.snapshot();
    expect(snap).toEqual({
      mrr: 0,
      arr: 0,
      activeCount: 0,
      cancelledLast30d: 0,
      churnRate: 0,
      currency: 'RON',
      byPlan: [],
    });
  });

  it('sums MRR, projects ARR=12x, groups by plan', async () => {
    const active = [
      { mrr: dec(100), plan: 'starter', currency: 'RON' },
      { mrr: dec(200), plan: 'starter', currency: 'RON' },
      { mrr: dec(500), plan: 'growth', currency: 'RON' },
    ];
    mockRunWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({
        customerSubscription: {
          findMany: vi.fn().mockResolvedValue(active),
          count: vi.fn().mockResolvedValue(0),
        },
      }),
    );

    const snap = await svc.snapshot();
    expect(snap.mrr).toBe(800);
    expect(snap.arr).toBe(9600);
    expect(snap.activeCount).toBe(3);
    expect(snap.byPlan).toEqual(
      expect.arrayContaining([
        { plan: 'starter', mrr: 300, count: 2 },
        { plan: 'growth', mrr: 500, count: 1 },
      ]),
    );
  });

  it('computes churn as cancelled / (active + cancelled)', async () => {
    const active = [
      { mrr: dec(100), plan: 'starter', currency: 'RON' },
      { mrr: dec(100), plan: 'starter', currency: 'RON' },
      { mrr: dec(100), plan: 'starter', currency: 'RON' },
    ];
    mockRunWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({
        customerSubscription: {
          findMany: vi.fn().mockResolvedValue(active),
          count: vi.fn().mockResolvedValue(1),
        },
      }),
    );

    const snap = await svc.snapshot();
    expect(snap.cancelledLast30d).toBe(1);
    expect(snap.churnRate).toBeCloseTo(0.25, 5);
  });

  it('uses "default" bucket when plan is null', async () => {
    const active = [{ mrr: dec(50), plan: null, currency: 'RON' }];
    mockRunWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({
        customerSubscription: {
          findMany: vi.fn().mockResolvedValue(active),
          count: vi.fn().mockResolvedValue(0),
        },
      }),
    );

    const snap = await svc.snapshot();
    expect(snap.byPlan).toEqual([{ plan: 'default', mrr: 50, count: 1 }]);
  });
});
