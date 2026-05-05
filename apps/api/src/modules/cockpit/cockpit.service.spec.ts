import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CockpitService } from './cockpit.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

describe('CockpitService.feed', () => {
  let svc: CockpitService;
  let dealsFindMany: ReturnType<typeof vi.fn>;
  let remindersFindMany: ReturnType<typeof vi.fn>;
  let tasksFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dealsFindMany = vi.fn().mockResolvedValue([]);
    remindersFindMany = vi.fn().mockResolvedValue([]);
    tasksFindMany = vi.fn().mockResolvedValue([]);

    const tx = {
      deal: { findMany: dealsFindMany },
      reminder: { findMany: remindersFindMany },
      task: { findMany: tasksFindMany },
    };
    const prisma = {
      runWithTenant: vi.fn(async (_tid: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as ConstructorParameters<typeof CockpitService>[0];
    svc = new CockpitService(prisma);
  });

  it('returns empty when nothing is open', async () => {
    const out = await svc.feed();
    expect(out).toEqual([]);
  });

  it('ranks high-value stalled deals above low-value ones', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    dealsFindMany.mockResolvedValueOnce([
      { id: 'd-big', title: 'Enterprise deal', value: 50000, currency: 'EUR', expectedCloseAt: null, updatedAt: tenDaysAgo },
      { id: 'd-small', title: 'Tiny deal', value: 500, currency: 'RON', expectedCloseAt: null, updatedAt: tenDaysAgo },
    ]);
    const out = await svc.feed();
    expect(out[0]?.entityId).toBe('d-big');
    expect(out[1]?.entityId).toBe('d-small');
  });

  it('marks reminders due now with the highest reminder score band', async () => {
    remindersFindMany.mockResolvedValueOnce([
      { id: 'r-now', title: 'Call lead', remindAt: new Date(Date.now() - 5 * 60 * 1000), subjectType: 'CONTACT', subjectId: 'c-1' },
      { id: 'r-later', title: 'Follow-up', remindAt: new Date(Date.now() + 5 * 3600 * 1000), subjectType: 'CONTACT', subjectId: 'c-2' },
    ]);
    const out = await svc.feed();
    const now = out.find((i) => i.entityId === 'r-now');
    const later = out.find((i) => i.entityId === 'r-later');
    expect(now?.score).toBeGreaterThan(later?.score ?? 0);
  });

  it('boosts HIGH priority overdue tasks above NORMAL ones', async () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    tasksFindMany.mockResolvedValueOnce([
      { id: 't-high', title: 'High task', priority: 'HIGH', dueAt: oneHourAgo, dealId: null },
      { id: 't-normal', title: 'Normal task', priority: 'NORMAL', dueAt: oneHourAgo, dealId: null },
    ]);
    const out = await svc.feed();
    const h = out.find((i) => i.entityId === 't-high');
    const n = out.find((i) => i.entityId === 't-normal');
    expect((h?.score ?? 0) - (n?.score ?? 0)).toBeGreaterThanOrEqual(25);
  });

  it('builds correct deep-link URLs', async () => {
    dealsFindMany.mockResolvedValueOnce([
      { id: 'd-1', title: 'Test', value: 1000, currency: 'RON', expectedCloseAt: null, updatedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) },
    ]);
    remindersFindMany.mockResolvedValueOnce([
      { id: 'r-1', title: 'Call', remindAt: new Date(), subjectType: 'CONTACT', subjectId: 'c-1' },
    ]);
    tasksFindMany.mockResolvedValueOnce([
      { id: 't-1', title: 'Send quote', priority: 'NORMAL', dueAt: new Date(Date.now() - 3600 * 1000), dealId: 'd-1' },
    ]);
    const out = await svc.feed();
    expect(out.find((i) => i.entityId === 'd-1')?.href).toBe('/app/deals/d-1');
    expect(out.find((i) => i.entityId === 'r-1')?.href).toBe('/app/contacts/c-1');
    expect(out.find((i) => i.entityId === 't-1')?.href).toBe('/app/deals/d-1');
  });
});
