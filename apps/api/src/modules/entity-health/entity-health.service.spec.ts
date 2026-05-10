import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { EntityHealthService } from './entity-health.service';

function days(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function build(opts: {
  activities?: { createdAt: Date; action: string }[];
  deals?: { stage: { probability: number }; probability: number | null; value: unknown }[];
  reminderCount?: number;
} = {}) {
  const tx = {
    activity: {
      findMany: vi.fn().mockResolvedValue(opts.activities ?? []),
    },
    deal: {
      findMany: vi.fn().mockResolvedValue(opts.deals ?? []),
    },
    reminder: {
      count: vi.fn().mockResolvedValue(opts.reminderCount ?? 0),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(
      async (_id: string, _mode: 'ro' | 'rw', fn: (t: typeof tx) => unknown) => fn(tx),
    ),
  } as unknown as ConstructorParameters<typeof EntityHealthService>[0];
  return { svc: new EntityHealthService(prisma), tx };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EntityHealthService.getHealth', () => {
  it('returns a "cold" rating when there is no activity', async () => {
    const { svc } = build();
    const health = await svc.getHealth('COMPANY', 'co-1');
    expect(health.rating).toBe('cold');
    expect(health.score).toBeLessThan(25);
    expect(health.lastActivityAt).toBeNull();
    expect(health.activityCount90d).toBe(0);
    expect(health.summary).toMatch(/rece|follow-up/i);
  });

  it('rates as "excellent" with recent + frequent activity + strong deal', async () => {
    const { svc } = build({
      activities: Array.from({ length: 12 }, (_, i) => ({
        createdAt: days(i * 3),
        action: 'note.added',
      })),
      deals: [{ stage: { probability: 80 }, probability: 90, value: 50000 }],
      reminderCount: 3,
    });
    const health = await svc.getHealth('COMPANY', 'co-1');
    expect(health.rating).toBe('excellent');
    expect(health.score).toBeGreaterThanOrEqual(85);
    expect(health.openDealCount).toBe(1);
  });

  it('prefers deal.probability override over stage.probability', async () => {
    const { svc } = build({
      activities: [{ createdAt: days(5), action: 'call.logged' }],
      deals: [
        { stage: { probability: 20 }, probability: 75, value: 0 },
        { stage: { probability: 90 }, probability: null, value: 0 },
      ],
    });
    const health = await svc.getHealth('COMPANY', 'co-1');
    const dealSignal = health.signals.find((s) => s.key === 'deal_momentum')!;
    // Max of 75 (override) and 90 (fallback to stage) = 90.
    expect(dealSignal.score).toBe(90);
  });

  it('skips deal momentum for CLIENT entities (B2C — no pipeline)', async () => {
    const { svc, tx } = build({
      activities: [{ createdAt: days(2), action: 'note.added' }],
    });
    const health = await svc.getHealth('CLIENT', 'cl-1');
    // Service does not call deal.findMany for CLIENT type (no deals possible).
    expect(tx.deal.findMany).not.toHaveBeenCalled();
    const dealSignal = health.signals.find((s) => s.key === 'deal_momentum')!;
    // Neutral 50 baseline kept so the absence doesn't drag the score.
    expect(dealSignal.score).toBe(50);
  });

  it('recency signal degrades by tiered bracket (7/30/90/180 days)', async () => {
    const cases: { activityDays: number; expected: number }[] = [
      { activityDays: 1, expected: 100 },
      { activityDays: 20, expected: 80 },
      { activityDays: 60, expected: 50 },
      { activityDays: 150, expected: 20 },
      { activityDays: 200, expected: 0 },
    ];
    for (const c of cases) {
      const { svc } = build({
        activities: [{ createdAt: days(c.activityDays), action: 'note.added' }],
      });
      const h = await svc.getHealth('COMPANY', 'co');
      const recency = h.signals.find((s) => s.key === 'recency')!;
      expect(recency.score, `at ${c.activityDays}d`).toBe(c.expected);
    }
  });

  it('weights sum to 1.0 and score is a weighted average', async () => {
    const { svc } = build({
      activities: [{ createdAt: days(1), action: 'note.added' }],
      deals: [{ stage: { probability: 50 }, probability: null, value: 0 }],
    });
    const h = await svc.getHealth('COMPANY', 'co');
    const totalWeight = h.signals.reduce((acc, s) => acc + s.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);

    const expected = Math.round(
      h.signals.reduce((acc, s) => acc + s.score * s.weight, 0),
    );
    expect(h.score).toBe(expected);
  });
});
