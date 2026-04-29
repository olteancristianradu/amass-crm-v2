import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TourProgressService } from './tour-progress.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn() },
  } as unknown as ConstructorParameters<typeof TourProgressService>[0];
  const svc = new TourProgressService(prisma);
  return { svc, prisma };
}

describe('TourProgressService.getCompletedTours', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns array from User.completedTours', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce({
      completedTours: ['companies-list', 'deals-kanban'],
    } as never);
    expect(await h.svc.getCompletedTours()).toEqual(['companies-list', 'deals-kanban']);
  });

  it('returns empty array when user not found', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce(null);
    expect(await h.svc.getCompletedTours()).toEqual([]);
  });

  it('filters non-string values defensively', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce({
      completedTours: ['valid-id', 42, null, 'another-valid', { junk: true }],
    } as never);
    expect(await h.svc.getCompletedTours()).toEqual(['valid-id', 'another-valid']);
  });
});

describe('TourProgressService.markCompleted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends new tour id', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce({
      completedTours: ['existing'],
    } as never);
    vi.mocked(h.prisma.user.update).mockResolvedValueOnce({} as never);
    const r = await h.svc.markCompleted('new-tour');
    expect(r).toEqual(['existing', 'new-tour']);
    expect(h.prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { completedTours: ['existing', 'new-tour'] },
    });
  });

  it('idempotent — does not duplicate', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce({
      completedTours: ['already-done'],
    } as never);
    const r = await h.svc.markCompleted('already-done');
    expect(r).toEqual(['already-done']);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('TourProgressService.markIncomplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes tour id when present', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce({
      completedTours: ['a', 'b', 'c'],
    } as never);
    vi.mocked(h.prisma.user.update).mockResolvedValueOnce({} as never);
    const r = await h.svc.markIncomplete('b');
    expect(r).toEqual(['a', 'c']);
  });

  it('idempotent — no-op when tour was not completed', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValueOnce({
      completedTours: ['a'],
    } as never);
    const r = await h.svc.markIncomplete('not-there');
    expect(r).toEqual(['a']);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });
});
