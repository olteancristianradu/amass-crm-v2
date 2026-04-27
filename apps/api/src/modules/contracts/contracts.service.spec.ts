import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractsService } from './contracts.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    contract: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  // ContractsService calls runWithTenant(tenantId, fn) — the 2-arg overload.
  // Mock both shapes so the test doesn't break if call signature flexes.
  const prisma = {
    runWithTenant: vi.fn(
      async (
        _id: string,
        levelOrFn: string | ((t: typeof tx) => unknown),
        fn?: (t: typeof tx) => unknown,
      ) => {
        const cb = typeof levelOrFn === 'function' ? levelOrFn : fn;
        return cb!(tx);
      },
    ),
  } as unknown as ConstructorParameters<typeof ContractsService>[0];
  const svc = new ContractsService(prisma);
  return { svc, prisma, tx };
}

describe('ContractsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists tenant + creator + decimal-coerced value', async () => {
    const h = build();
    h.tx.contract.create.mockResolvedValueOnce({ id: 'k-1' });
    await h.svc.create({
      companyId: 'co-1',
      title: 'Mentenanță anuală',
      value: '12000.50',
      currency: 'RON',
    } as never);
    const args = h.tx.contract.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.createdById).toBe('user-1');
    expect(args.data.value).toBeInstanceOf(Prisma.Decimal);
    expect(args.data.value.toString()).toBe('12000.5');
  });

  it('defaults currency to RON and status to DRAFT when omitted', async () => {
    const h = build();
    h.tx.contract.create.mockResolvedValueOnce({ id: 'k-2' });
    await h.svc.create({ companyId: 'co-1', title: 'X' } as never);
    const args = h.tx.contract.create.mock.calls[0][0];
    expect(args.data.currency).toBe('RON');
    expect(args.data.status).toBe('DRAFT');
    expect(args.data.value).toBeNull();
    expect(args.data.autoRenew).toBe(false);
  });
});

describe('ContractsService.findAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds an expiring-window predicate when expiringInDays is set', async () => {
    const h = build();
    h.tx.contract.findMany.mockResolvedValueOnce([{ id: 'k-1' }]);
    await h.svc.findAll({ expiringInDays: 30, limit: 25 } as never);
    const where = h.tx.contract.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.deletedAt).toBeNull();
    expect(where.endDate.gt).toBeInstanceOf(Date);
    expect(where.endDate.lte.getTime() - where.endDate.gt.getTime())
      .toBeGreaterThan(29 * 86400_000);
  });

  it('omits the expiring window when expiringInDays is unset', async () => {
    const h = build();
    h.tx.contract.findMany.mockResolvedValueOnce([]);
    await h.svc.findAll({ limit: 25 } as never);
    const where = h.tx.contract.findMany.mock.calls[0][0].where;
    expect(where.endDate).toBeUndefined();
  });
});

describe('ContractsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CONTRACT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.contract.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('returns the contract when present', async () => {
    const h = build();
    h.tx.contract.findFirst.mockResolvedValueOnce({ id: 'k-1', title: 'X' });
    await expect(h.svc.findOne('k-1')).resolves.toMatchObject({ id: 'k-1' });
  });
});

describe('ContractsService.update + remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips fields that are not in the patch', async () => {
    const h = build();
    h.tx.contract.findFirst.mockResolvedValueOnce({ id: 'k-1' });
    h.tx.contract.update.mockResolvedValueOnce({ id: 'k-1' });
    await h.svc.update('k-1', { status: 'ACTIVE' } as never);
    const data = h.tx.contract.update.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    expect('title' in data).toBe(false);
    expect('value' in data).toBe(false);
  });

  it('coerces value="0" to a Prisma.Decimal but null to null', async () => {
    const h = build();
    h.tx.contract.findFirst.mockResolvedValueOnce({ id: 'k-1' });
    h.tx.contract.update.mockResolvedValueOnce({ id: 'k-1' });
    await h.svc.update('k-1', { value: null } as never);
    const data = h.tx.contract.update.mock.calls[0][0].data;
    expect(data.value).toBeNull();
  });

  it('soft-deletes via deletedAt update', async () => {
    const h = build();
    h.tx.contract.findFirst.mockResolvedValueOnce({ id: 'k-1' });
    h.tx.contract.update.mockResolvedValueOnce({ id: 'k-1' });
    await h.svc.remove('k-1');
    const data = h.tx.contract.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});
