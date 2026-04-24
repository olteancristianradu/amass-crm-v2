import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service';
import { AuditEntry } from './audit.service';

/**
 * These tests stub PrismaService with the minimum surface AuditService
 * actually uses. We focus on the business invariants that matter:
 *  - list() returns {data, nextCursor} via the sliceCursorPage helper
 *  - log() drops writes when there's no tenant context + no explicit tenantId
 *  - pruneExpiredForTenant skips when retentionDays <= 0
 */

type TxStub = {
  auditLog: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(overrides: Partial<TxStub['auditLog']> = {}) {
  const tx: TxStub = {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'a1', createdAt: new Date() }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  };
  return {
    tx,
    prisma: {
      auditLog: tx.auditLog,
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ siemWebhookUrl: null }),
      },
      runWithTenant: vi.fn(async (_tenantId: string, fn: (t: TxStub) => unknown) => fn(tx)),
    } as unknown as ConstructorParameters<typeof AuditService>[0],
  };
}

vi.mock('../../infra/prisma/tenant-context', () => ({
  getTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list()', () => {
    it('returns empty page when no tenant context is present', async () => {
      const { prisma } = makePrisma();
      const { getTenantContext } = await import('../../infra/prisma/tenant-context');
      vi.mocked(getTenantContext).mockReturnValueOnce(undefined);
      const svc = new AuditService(prisma);
      const out = await svc.list({ limit: 20 });
      expect(out).toEqual({ data: [], nextCursor: null });
    });

    it('returns {data, nextCursor: <last id>} when rows >= limit+1', async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({
        id: `a${i}`,
        tenantId: 'tenant-1',
        action: 'x',
        createdAt: new Date(),
      }));
      const { prisma, tx } = makePrisma();
      tx.auditLog.findMany.mockResolvedValue(rows);
      const svc = new AuditService(prisma);
      const out = await svc.list({ limit: 20 });
      expect(out.data.length).toBe(20);
      expect(out.nextCursor).toBe('a19');
    });

    it('returns nextCursor=null when rows < limit+1', async () => {
      const { prisma, tx } = makePrisma();
      tx.auditLog.findMany.mockResolvedValue([{ id: 'x', tenantId: 't', action: 'a' }]);
      const svc = new AuditService(prisma);
      const out = await svc.list({ limit: 10 });
      expect(out.nextCursor).toBeNull();
    });
  });

  describe('log()', () => {
    it('drops the write silently when no tenant can be resolved', async () => {
      const { prisma, tx } = makePrisma();
      const { getTenantContext } = await import('../../infra/prisma/tenant-context');
      vi.mocked(getTenantContext).mockReturnValueOnce(undefined);
      const svc = new AuditService(prisma);
      const entry: AuditEntry = { action: 'x.y' };
      await svc.log(entry);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('writes with tenantId from ALS context + actor from ALS', async () => {
      const { prisma, tx } = makePrisma();
      const svc = new AuditService(prisma);
      await svc.log({ action: 'deal.create', subjectType: 'Deal', subjectId: 'd1' });
      expect(tx.auditLog.create).toHaveBeenCalled();
      const call = tx.auditLog.create.mock.calls[0][0].data;
      expect(call.tenantId).toBe('tenant-1');
      expect(call.actorId).toBe('user-1');
      expect(call.action).toBe('deal.create');
    });

    it('explicit tenantId on the entry overrides ALS (used by system jobs)', async () => {
      const { prisma, tx } = makePrisma();
      const svc = new AuditService(prisma);
      await svc.log({ action: 'system.x', tenantId: 'override-tenant', actorId: 'sys' });
      expect(tx.auditLog.create).toHaveBeenCalled();
      const call = tx.auditLog.create.mock.calls[0][0].data;
      expect(call.tenantId).toBe('override-tenant');
      expect(call.actorId).toBe('sys');
    });
  });

  describe('pruneExpiredForTenant()', () => {
    it('returns 0 without touching the DB when retentionDays <= 0', async () => {
      const { prisma, tx } = makePrisma();
      const svc = new AuditService(prisma);
      const out = await svc.pruneExpiredForTenant('t1', 0);
      expect(out).toBe(0);
      expect(tx.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('uses runWithTenant so RLS + tenantExtension scope the DELETE', async () => {
      const { prisma, tx } = makePrisma();
      tx.auditLog.deleteMany.mockResolvedValue({ count: 42 });
      const svc = new AuditService(prisma);
      const out = await svc.pruneExpiredForTenant('t1', 30);
      expect(out).toBe(42);
      expect(prisma.runWithTenant).toHaveBeenCalledWith('t1', expect.any(Function));
      const where = tx.auditLog.deleteMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('t1');
      expect(where.createdAt.lt).toBeInstanceOf(Date);
    });
  });
});
