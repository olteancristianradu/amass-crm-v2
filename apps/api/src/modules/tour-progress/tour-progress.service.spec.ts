import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TourProgressService } from './tour-progress.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  // P1-2 fix: service now uses runWithTenant for all user reads/writes.
  // tx carries the methods the service calls inside the transaction.
  const tx = {
    user: { findFirst: vi.fn(), update: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof TourProgressService>[0];
  const svc = new TourProgressService(prisma);
  return { svc, prisma, tx };
}

describe('TourProgressService.getCompletedTours', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns array from User.completedTours', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValueOnce({
      completedTours: ['companies-list', 'deals-kanban'],
    });
    expect(await h.svc.getCompletedTours()).toEqual(['companies-list', 'deals-kanban']);
  });

  it('returns empty array when user not found', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValueOnce(null);
    expect(await h.svc.getCompletedTours()).toEqual([]);
  });

  it('filters non-string values defensively', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValueOnce({
      completedTours: ['valid-id', 42, null, 'another-valid', { junk: true }],
    });
    expect(await h.svc.getCompletedTours()).toEqual(['valid-id', 'another-valid']);
  });
});

describe('TourProgressService.markCompleted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends new tour id', async () => {
    const h = build();
    h.tx.user.findFirst
      .mockResolvedValueOnce({ completedTours: ['existing'] }) // getCompletedTours inside markCompleted
      .mockResolvedValueOnce({ completedTours: ['existing'] }); // second getCompletedTours call won't happen, but defensive
    h.tx.user.update.mockResolvedValueOnce({});
    const r = await h.svc.markCompleted('new-tour');
    expect(r).toEqual(['existing', 'new-tour']);
    expect(h.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { completedTours: ['existing', 'new-tour'] },
    });
  });

  it('idempotent — does not duplicate', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValueOnce({ completedTours: ['already-done'] });
    const r = await h.svc.markCompleted('already-done');
    expect(r).toEqual(['already-done']);
    expect(h.tx.user.update).not.toHaveBeenCalled();
  });
});

describe('TourProgressService.markIncomplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes tour id when present', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValueOnce({ completedTours: ['a', 'b', 'c'] });
    h.tx.user.update.mockResolvedValueOnce({});
    const r = await h.svc.markIncomplete('b');
    expect(r).toEqual(['a', 'c']);
  });

  it('idempotent — no-op when tour was not completed', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValueOnce({ completedTours: ['a'] });
    const r = await h.svc.markIncomplete('not-there');
    expect(r).toEqual(['a']);
    expect(h.tx.user.update).not.toHaveBeenCalled();
  });
});
