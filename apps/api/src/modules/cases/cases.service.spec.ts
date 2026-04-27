import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CasePriority } from '@prisma/client';
import { CasesService } from './cases.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();

describe('CasesService', () => {
  let svc: CasesService;
  // For escalateOverdueForAllTenants the service hits prisma.case directly (no runWithTenant).
  const directCase = { findMany: vi.fn(), update: vi.fn() };
  const mockPrisma = { runWithTenant: mockRunWithTenant, case: directCase } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new CasesService(mockPrisma);
  });

  it('create() assigns next sequential number per tenant', async () => {
    const findFirst = vi.fn().mockResolvedValue({ number: 42 });
    const create = vi.fn().mockImplementation(async ({ data }) => ({ id: 'case-1', ...data }));
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ case: { findFirst, create }, $executeRaw: vi.fn().mockResolvedValue(1) }),
    );

    await svc.create({ subject: 'Broken', priority: 'NORMAL' } as any);

    expect(create.mock.calls[0][0].data.number).toBe(43);
    expect(create.mock.calls[0][0].data.tenantId).toBe('tenant-1');
  });

  it('create() starts at 1 when no previous cases', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockImplementation(async ({ data }) => ({ id: 'case-1', ...data }));
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ case: { findFirst, create }, $executeRaw: vi.fn().mockResolvedValue(1) }),
    );

    await svc.create({ subject: 'Broken', priority: 'NORMAL' } as any);
    expect(create.mock.calls[0][0].data.number).toBe(1);
  });

  it('update() stamps resolvedAt on OPEN → RESOLVED', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'c-1', status: 'OPEN' });
    const update = vi.fn().mockResolvedValue({});
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findFirst, update } }));

    await svc.update('c-1', { status: 'RESOLVED' } as any);
    expect(update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
  });

  it('update() does not re-stamp resolvedAt when already RESOLVED', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'c-1', status: 'RESOLVED' });
    const update = vi.fn().mockResolvedValue({});
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findFirst, update } }));

    await svc.update('c-1', { status: 'CLOSED' } as any);
    expect(update.mock.calls[0][0].data.resolvedAt).toBeUndefined();
  });

  it('findOne() throws NotFoundException when missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ case: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.findOne('x')).rejects.toThrow(NotFoundException);
  });

  describe('escalateOverdueForAllTenants', () => {
    it('returns 0 when no overdue cases', async () => {
      directCase.findMany.mockResolvedValue([]);
      const n = await svc.escalateOverdueForAllTenants();
      expect(n).toBe(0);
      expect(directCase.update).not.toHaveBeenCalled();
    });

    it('promotes NORMAL → HIGH and HIGH → URGENT', async () => {
      directCase.findMany.mockResolvedValue([
        { id: 'c-1', priority: CasePriority.NORMAL },
        { id: 'c-2', priority: CasePriority.HIGH },
        { id: 'c-3', priority: CasePriority.LOW },
      ]);
      directCase.update.mockResolvedValue({});

      const n = await svc.escalateOverdueForAllTenants();
      expect(n).toBe(3);
      expect(directCase.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { priority: CasePriority.HIGH },
      });
      expect(directCase.update).toHaveBeenCalledWith({
        where: { id: 'c-2' },
        data: { priority: CasePriority.URGENT },
      });
      // LOW is not NORMAL, so it escalates straight to URGENT per the fallback branch.
      expect(directCase.update).toHaveBeenCalledWith({
        where: { id: 'c-3' },
        data: { priority: CasePriority.URGENT },
      });
    });

    it('filters URGENT cases out via query predicate (not by code)', async () => {
      directCase.findMany.mockResolvedValue([]);
      await svc.escalateOverdueForAllTenants();
      const where = directCase.findMany.mock.calls[0][0].where;
      expect(where.priority).toEqual({ not: CasePriority.URGENT });
      expect(where.resolvedAt).toBeNull();
      expect(where.deletedAt).toBeNull();
      expect(where.slaDeadline).toMatchObject({ not: null });
      expect(where.slaDeadline.lt).toBeInstanceOf(Date);
    });
  });
});
