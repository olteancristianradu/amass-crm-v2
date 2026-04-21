import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommissionsService } from './commissions.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('CommissionsService.compute', () => {
  let svc: CommissionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new CommissionsService(mockPrisma);
  });

  const setup = (deals: unknown[], plan = { id: 'plan-1', percent: new Prisma.Decimal(10), tenantId: 'tenant-1' }) => {
    const findFirst = vi.fn().mockResolvedValue(plan);
    const findMany = vi.fn().mockResolvedValue(deals);
    const upsert = vi.fn().mockImplementation(async ({ create }) => ({ id: `c-${create.userId}`, ...create }));
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({
        commissionPlan: { findFirst },
        deal: { findMany },
        commission: { upsert },
      }),
    );
    return { findFirst, findMany, upsert };
  };

  it('groups deals by owner, applies percent, upserts one row per user', async () => {
    const { upsert, findMany } = setup([
      { ownerId: 'u-1', value: new Prisma.Decimal(1000), currency: 'RON' },
      { ownerId: 'u-1', value: new Prisma.Decimal(500), currency: 'RON' },
      { ownerId: 'u-2', value: new Prisma.Decimal(400), currency: 'RON' },
    ]);

    const result = await svc.compute({ planId: 'plan-1', year: 2026, month: 4 } as any);

    // Uses UTC month window — April 2026 [2026-04-01, 2026-05-01).
    const wherePassed = findMany.mock.calls[0][0].where;
    expect(wherePassed.status).toBe('WON');
    expect(wherePassed.closedAt.gte.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(wherePassed.closedAt.lt.toISOString()).toBe('2026-05-01T00:00:00.000Z');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);

    const u1 = upsert.mock.calls.find((c) => c[0].create.userId === 'u-1')?.[0].create;
    expect(u1.dealsCount).toBe(2);
    expect(Number(u1.basis)).toBe(1500);
    expect(Number(u1.amount)).toBe(150); // 10% of 1500
  });

  it('throws NotFoundException when plan is missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ commissionPlan: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(
      svc.compute({ planId: 'missing', year: 2026, month: 4 } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns empty array when no WON deals in window', async () => {
    setup([]);
    const result = await svc.compute({ planId: 'plan-1', year: 2026, month: 4 } as any);
    expect(result).toEqual([]);
  });

  it('skips deals with null ownerId', async () => {
    // Prisma query already filters ownerId != null, but defensively the
    // loop also no-ops when ownerId is nullish.
    const { upsert } = setup([
      { ownerId: null, value: new Prisma.Decimal(1000), currency: 'RON' },
    ]);
    const result = await svc.compute({ planId: 'plan-1', year: 2026, month: 4 } as any);
    expect(upsert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
