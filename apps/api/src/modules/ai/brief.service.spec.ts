import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefService } from './brief.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({})),
}));

/**
 * BriefService is exercised end-to-end with stubbed Prisma + Redis. The LLM
 * path is not invoked here (no API key in env mock → provider='none' → static
 * fallback), but every cache + context branch is covered.
 */
function build(opts: { redisGet?: string | null } = {}) {
  const tx = {
    user: { findFirst: vi.fn().mockResolvedValue({ fullName: 'Andrei P.', email: 'a@x.ro' }) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    reminder: { findMany: vi.fn().mockResolvedValue([]) },
    deal: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    call: { count: vi.fn().mockResolvedValue(0) },
    company: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, _level: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof BriefService>[0];
  const redisStore = new Map<string, string>();
  if (opts.redisGet !== undefined && opts.redisGet !== null) {
    redisStore.set('brief:tenant-1:user-1', opts.redisGet);
  }
  const redis = {
    client: {
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        redisStore.set(k, v);
        return 'OK';
      }),
      del: vi.fn(async (k: string) => {
        redisStore.delete(k);
        return 1;
      }),
    },
  } as unknown as ConstructorParameters<typeof BriefService>[1];
  const svc = new BriefService(prisma, redis);
  return { svc, prisma, tx, redis, redisStore };
}

describe('BriefService.getBrief', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the cached payload when Redis has a hit and fresh=false', async () => {
    const cached = JSON.stringify({
      summary: 'Cached summary',
      priorities: [{ action: 'Cached action', icon: 'TASK' }],
      generatedAt: '2026-04-27T08:00:00.000Z',
      cached: false,
      source: 'ai',
    });
    const h = build({ redisGet: cached });
    const out = await h.svc.getBrief();
    expect(out.summary).toBe('Cached summary');
    expect(out.cached).toBe(true);
    // Cache hit means we never touched Prisma.
    expect(h.prisma.runWithTenant).not.toHaveBeenCalled();
  });

  it('drops a corrupt cache entry and recomputes from Prisma', async () => {
    const h = build({ redisGet: 'NOT_JSON' });
    await h.svc.getBrief();
    expect(h.redis.client.del).toHaveBeenCalledWith('brief:tenant-1:user-1');
    expect(h.prisma.runWithTenant).toHaveBeenCalled();
  });

  it('uses the static fallback when no AI provider is configured', async () => {
    const h = build();
    h.tx.task.findMany
      .mockResolvedValueOnce([
        { title: 'Sună Acme', dueAt: new Date(Date.now() - 86400000), priority: 'HIGH', deal: { title: 'Acme Q3' } },
      ])
      .mockResolvedValueOnce([]); // today's tasks
    const out = await h.svc.getBrief({ fresh: true });
    expect(out.source).toBe('static');
    expect(out.priorities).toHaveLength(3);
    expect(out.priorities[0].action).toContain('Sună Acme');
    // Cache was written for next call.
    expect(h.redis.client.set).toHaveBeenCalledWith(
      'brief:tenant-1:user-1',
      expect.stringContaining('"summary"'),
      'EX',
      30 * 60,
    );
  });

  it('renders an idle copy when there is nothing on the agenda', async () => {
    const h = build();
    const out = await h.svc.getBrief({ fresh: true });
    expect(out.summary).toMatch(/Nicio urgență/);
    expect(out.priorities).toHaveLength(3); // padded
  });

  it('skips per-user filters when tenant context has no userId', async () => {
    const { requireTenantContext } = await import('../../infra/prisma/tenant-context');
    vi.mocked(requireTenantContext).mockReturnValueOnce({ tenantId: 'tenant-1' } as never);
    const h = build();
    const out = await h.svc.getBrief();
    // No userId → static fallback path; no Redis writes either.
    expect(out.source).toBe('static');
    expect(h.redis.client.set).not.toHaveBeenCalled();
  });

  it('resolves company names for closing deals via a follow-up findMany', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValueOnce([
      {
        title: 'Renew XYZ',
        value: '12000',
        currency: 'RON',
        expectedCloseAt: new Date(Date.now() + 3 * 86400000),
        companyId: 'co-1',
      },
    ]);
    h.tx.company.findMany.mockResolvedValueOnce([{ id: 'co-1', name: 'XYZ SRL' }]);
    const out = await h.svc.getBrief({ fresh: true });
    // Static priorities will include the deal as #1 since there are no overdue tasks.
    const dealPriority = out.priorities.find((p) => p.icon === 'DEAL');
    expect(dealPriority?.context).toContain('XYZ SRL');
  });
});
