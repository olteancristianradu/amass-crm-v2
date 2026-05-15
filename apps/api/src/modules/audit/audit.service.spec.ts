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
vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({ SIEM_WEBHOOK_URL: '' })),
}));
// Reset breaker state between tests so a prior trip doesn't reject later
// fetch attempts before we even mock them.
import { resetBreakers } from '../../common/resilience/circuit-breaker';
import { loadEnv } from '../../config/env';
const mockLoadEnv = vi.mocked(loadEnv);

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBreakers();
    mockLoadEnv.mockReturnValue({ SIEM_WEBHOOK_URL: '' } as never);
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

    it('catches DB write failure and does NOT throw (best-effort contract)', async () => {
      const { prisma } = makePrisma();
      (prisma as unknown as { runWithTenant: ReturnType<typeof vi.fn> }).runWithTenant = vi
        .fn()
        .mockRejectedValue(new Error('connection lost'));
      const svc = new AuditService(prisma);
      // Must NOT throw — business flow continues even when audit DB is down.
      await expect(svc.log({ action: 'deal.create' })).resolves.toBeUndefined();
    });
  });

  describe('SIEM forwarding (private path, exercised via log())', () => {
    it('skips fetch when no URL is configured (tenant null + env empty)', async () => {
      const { prisma } = makePrisma();
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const svc = new AuditService(prisma);

      await svc.log({ action: 'deal.x' });
      // Give the fire-and-forget promise a tick to schedule.
      await new Promise((r) => setTimeout(r, 0));
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('uses the tenant SIEM webhook URL when set (overrides global env)', async () => {
      const { prisma } = makePrisma();
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ siemWebhookUrl: 'https://tenant-siem' } as never);
      mockLoadEnv.mockReturnValue({ SIEM_WEBHOOK_URL: 'https://global-siem' } as never);
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as never);
      vi.stubGlobal('fetch', fetchSpy);
      const svc = new AuditService(prisma);

      await svc.log({ action: 'deal.x' });
      // Wait two ticks for the fire-and-forget promise + the breaker.exec await.
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://tenant-siem');
      vi.unstubAllGlobals();
    });

    it('falls back to global SIEM_WEBHOOK_URL when tenant has none', async () => {
      const { prisma } = makePrisma();
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ siemWebhookUrl: null } as never);
      mockLoadEnv.mockReturnValue({ SIEM_WEBHOOK_URL: 'https://global-siem' } as never);
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as never);
      vi.stubGlobal('fetch', fetchSpy);
      const svc = new AuditService(prisma);

      await svc.log({ action: 'deal.x' });
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://global-siem');
      vi.unstubAllGlobals();
    });

    it('swallows fetch rejections from a broken SIEM collector (does NOT crash log())', async () => {
      const { prisma } = makePrisma();
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ siemWebhookUrl: 'https://broken' } as never);
      const fetchSpy = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', fetchSpy);
      const svc = new AuditService(prisma);

      // log() itself must still resolve — the SIEM forward is fire-and-forget.
      await expect(svc.log({ action: 'deal.x' })).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchSpy).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('warns + swallows on non-2xx SIEM response (still fire-and-forget)', async () => {
      const { prisma } = makePrisma();
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ siemWebhookUrl: 'https://siem' } as never);
      const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 503 } as never);
      vi.stubGlobal('fetch', fetchSpy);
      const svc = new AuditService(prisma);

      await expect(svc.log({ action: 'deal.x' })).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchSpy).toHaveBeenCalled();
      vi.unstubAllGlobals();
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
