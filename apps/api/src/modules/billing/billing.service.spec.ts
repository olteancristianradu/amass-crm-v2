import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingService } from './billing.service';

/**
 * BillingService tests focus on the tenant-routing + idempotency logic in
 * processStripeEvent — the code path a leaked Stripe key would target.
 * Full checkout/portal flows touch Stripe SDK + env and are better in e2e.
 */

function build() {
  const redisStore = new Map<string, string>();
  const prisma = {
    billingSubscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    runWithTenant: vi.fn(async (_tid: string, fn: (t: unknown) => unknown) => {
      // real impl: runs a transaction; we just call the callback with a stub
      // tx that forwards to the same billingSubscription mock.
      const tx = { billingSubscription: prisma.billingSubscription };
      return fn(tx);
    }),
  } as unknown as ConstructorParameters<typeof BillingService>[0];
  const redis = {
    client: {
      set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
        if (redisStore.has(key)) return null; // NX = not set
        redisStore.set(key, value);
        return 'OK';
      }),
    },
  } as unknown as ConstructorParameters<typeof BillingService>[1];
  const svc = new BillingService(prisma, redis);
  return { svc, prisma, redis, redisStore };
}

describe('BillingService.processStripeEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  const makeSubEvent = (customerId = 'cus_123', status = 'active') => ({
    id: 'evt_abc123',
    type: 'customer.subscription.updated' as const,
    data: {
      object: {
        id: 'sub_xyz',
        customer: customerId,
        status,
        cancel_at_period_end: false,
        current_period_start: 1700000000,
        current_period_end: 1702678400,
        items: { data: [{ price: { id: 'price_starter' } }] },
        metadata: { tenantId: 'claimed-tenant' },
      },
    },
  });

  it('is idempotent — second delivery of same event.id is a no-op', async () => {
    const h = build();
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    const upsert = vi.fn(async () => ({}));
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { upsert } } as unknown),
    ) as never;
    await h.svc.processStripeEvent(makeSubEvent());
    const firstCalls = upsert.mock.calls.length;
    await h.svc.processStripeEvent(makeSubEvent());
    // On the second call, upsert MUST NOT run — Redis SETNX blocks the dup.
    expect(upsert.mock.calls.length).toBe(firstCalls);
  });

  it('routes via stripeCustomerId DB lookup (not via metadata)', async () => {
    const h = build();
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue({ tenantId: 'real-tenant' } as never);
    const updatedRows: unknown[] = [];
    // capture the upsert call
    const upsert = vi.fn(async (args: { where: { tenantId: string } }) => {
      updatedRows.push(args.where.tenantId);
      return {};
    });
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { upsert } } as unknown),
    ) as never;

    await h.svc.processStripeEvent(makeSubEvent('cus_real'));
    expect(updatedRows[0]).toBe('real-tenant');
  });

  it('falls back to metadata tenantId only if NO DB match AND claimed tenant has no conflicting customer', async () => {
    const h = build();
    // No existing sub by customer id
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue(null);
    // Claimed tenant has no prior customer
    vi.mocked(h.prisma.billingSubscription.findUnique).mockResolvedValue(null);
    const upsert = vi.fn(async () => ({}));
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { upsert } } as unknown),
    ) as never;

    await h.svc.processStripeEvent(makeSubEvent('cus_new'));
    expect(upsert).toHaveBeenCalled();
  });

  it('REFUSES when claimed metadata tenantId conflicts with a different existing stripeCustomerId', async () => {
    const h = build();
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue(null);
    // Victim tenant already owns customer cus_victim
    vi.mocked(h.prisma.billingSubscription.findUnique).mockResolvedValue({
      stripeCustomerId: 'cus_victim',
    } as never);
    const upsert = vi.fn();
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { upsert } } as unknown),
    ) as never;
    // Attacker's event claims metadata.tenantId=victim-tenant but customer is cus_attacker
    await h.svc.processStripeEvent(makeSubEvent('cus_attacker'));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('ignores unknown event types silently', async () => {
    const h = build();
    await h.svc.processStripeEvent({
      id: 'evt_x',
      type: 'invoice.finalized',
      data: { object: {} },
    });
    expect(h.prisma.billingSubscription.findFirst).not.toHaveBeenCalled();
  });
});
