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

  describe('findAll', () => {
    it('filters by tenant + soft-delete + optional status/priority/assignee/company', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findMany } }));

      await svc.findAll({
        status: 'OPEN',
        priority: 'HIGH',
        assigneeId: 'u1',
        companyId: 'co1',
        limit: 20,
      } as any);

      expect(findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: 'tenant-1',
        deletedAt: null,
        status: 'OPEN',
        priority: 'HIGH',
        assigneeId: 'u1',
        companyId: 'co1',
      });
      expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('omits filters when query keys are not set', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findMany } }));

      await svc.findAll({ limit: 50 } as any);
      const where = findMany.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
      expect(where.priority).toBeUndefined();
      expect(where.assigneeId).toBeUndefined();
      expect(where.companyId).toBeUndefined();
    });
  });

  describe('remove (soft-delete)', () => {
    it('throws NotFound when target missing', async () => {
      mockRunWithTenant.mockImplementation(async (_t, fn) =>
        fn({ case: { findFirst: vi.fn().mockResolvedValue(null) } }),
      );
      await expect(svc.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stamps deletedAt without hard-deleting', async () => {
      const update = vi.fn().mockResolvedValue({});
      // findOne lookup
      mockRunWithTenant.mockImplementationOnce(async (_t, fn) =>
        fn({ case: { findFirst: vi.fn().mockResolvedValue({ id: 'c-1' }) } }),
      );
      // soft-delete update
      mockRunWithTenant.mockImplementationOnce(async (_t, fn) => fn({ case: { update } }));

      await svc.remove('c-1');
      const args = update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'c-1' });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('update — terminal-state stamping', () => {
    it('does NOT stamp resolvedAt on OPEN → IN_PROGRESS', async () => {
      const findFirst = vi.fn().mockResolvedValue({ id: 'c-1', status: 'OPEN' });
      const update = vi.fn().mockResolvedValue({});
      mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findFirst, update } }));

      await svc.update('c-1', { status: 'IN_PROGRESS' } as any);
      expect(update.mock.calls[0][0].data.resolvedAt).toBeUndefined();
    });

    it('stamps resolvedAt when reaching CLOSED for the first time', async () => {
      const findFirst = vi.fn().mockResolvedValue({ id: 'c-1', status: 'OPEN' });
      const update = vi.fn().mockResolvedValue({});
      mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findFirst, update } }));

      await svc.update('c-1', { status: 'CLOSED', resolution: 'fix shipped' } as any);
      expect(update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
      expect(update.mock.calls[0][0].data.resolution).toBe('fix shipped');
    });

    it('only includes patch keys present in the dto', async () => {
      const findFirst = vi.fn().mockResolvedValue({ id: 'c-1', status: 'OPEN' });
      const update = vi.fn().mockResolvedValue({});
      mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ case: { findFirst, update } }));

      await svc.update('c-1', { subject: 'New subj' } as any);
      const data = update.mock.calls[0][0].data;
      expect(data.subject).toBe('New subj');
      expect(data.priority).toBeUndefined();
      expect(data.assigneeId).toBeUndefined();
    });
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
