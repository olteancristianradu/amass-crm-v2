import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CedarContextService } from './cedar-context.service';

function build() {
  const tx = {
    deal: { findFirst: vi.fn() },
    task: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    quote: { findFirst: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof CedarContextService>[0];
  const svc = new CedarContextService(prisma);
  return { svc, prisma, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Reset the static singleton so each test starts clean.
  (CedarContextService as unknown as { instance: CedarContextService | null }).instance = null;
});

describe('CedarContextService.isOwnerOf', () => {
  it('returns isOwner=false when the row does not exist', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValueOnce(null);
    const out = await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'deal', 'd-1');
    expect(out).toEqual({ isOwner: false });
  });

  it('deal: compares ownerId against user.userId', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValueOnce({ ownerId: 'u-1' });
    expect(await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'deal', 'd-1'))
      .toEqual({ isOwner: true });
    h.tx.deal.findFirst.mockResolvedValueOnce({ ownerId: 'u-X' });
    expect(await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'deal', 'd-1'))
      .toEqual({ isOwner: false });
  });

  it('task: compares assigneeId (not ownerId)', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({ assigneeId: 'u-1' });
    expect(await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'task', 't-1'))
      .toEqual({ isOwner: true });
  });

  it('lead: compares ownerId', async () => {
    const h = build();
    h.tx.lead.findFirst.mockResolvedValueOnce({ ownerId: 'u-2' });
    expect(await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'lead', 'l-1'))
      .toEqual({ isOwner: false });
  });

  it('quote: compares createdById (closest thing to ownership)', async () => {
    const h = build();
    h.tx.quote.findFirst.mockResolvedValueOnce({ createdById: 'u-1' });
    expect(await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'quote', 'q-1'))
      .toEqual({ isOwner: true });
  });

  it('fails closed when the lookup errors (does NOT escalate privileges)', async () => {
    const h = build();
    h.tx.deal.findFirst.mockRejectedValueOnce(new Error('boom'));
    expect(await h.svc.isOwnerOf({ tenantId: 't', userId: 'u-1' } as never, 'deal', 'd-1'))
      .toEqual({ isOwner: false });
  });
});

describe('CedarContextService.ownerOf — request-shaped factory', () => {
  it('returns isOwner=false when req.user is missing', async () => {
    build();
    const ctx = await CedarContextService.ownerOf('deal')({ params: { id: 'd-1' } });
    expect(ctx).toEqual({ isOwner: false });
  });

  it('returns isOwner=false when the param is missing', async () => {
    build();
    const ctx = await CedarContextService.ownerOf('deal')({
      user: { tenantId: 't', userId: 'u-1' },
      params: {},
    });
    expect(ctx).toEqual({ isOwner: false });
  });

  it('extracts a custom paramName when provided', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValueOnce({ ownerId: 'u-1' });
    const ctx = await CedarContextService.ownerOf('deal', 'dealId')({
      user: { tenantId: 't', userId: 'u-1' },
      params: { dealId: 'd-9' },
    });
    expect(ctx).toEqual({ isOwner: true });
    const where = h.tx.deal.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('d-9');
  });
});

describe('CedarContextService.getInstance', () => {
  it('throws when the service has never been instantiated', () => {
    expect(() => CedarContextService.getInstance()).toThrow(
      /CedarContextService not initialised/,
    );
  });

  it('returns the constructor-stored singleton after init', () => {
    const h = build();
    expect(CedarContextService.getInstance()).toBe(h.svc);
  });
});
