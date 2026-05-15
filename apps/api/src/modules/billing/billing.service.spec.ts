import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — must be declared before importing the module under test.
vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({})),
}));
vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'OWNER' })),
}));

import { BillingService } from './billing.service';
import { loadEnv } from '../../config/env';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { resetBreakers } from '../../common/resilience/circuit-breaker';

const mockLoadEnv = vi.mocked(loadEnv);
const mockRequireTenantContext = vi.mocked(requireTenantContext);

/**
 * BillingService tests focus on the tenant-routing + idempotency logic in
 * processStripeEvent — the code path a leaked Stripe key would target —
 * plus the four customer-facing surface methods (getSubscription, checkout,
 * billing portal, webhook). The Stripe SDK is replaced with a hand-rolled
 * stub on `svc.stripe` so no network calls leak from CI.
 */

interface StripeStub {
  customers: { create: ReturnType<typeof vi.fn> };
  checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
  billingPortal: { sessions: { create: ReturnType<typeof vi.fn> } };
  webhooks: { constructEvent: ReturnType<typeof vi.fn> };
  subscriptions: Record<string, unknown>;
}

function makeStripeStub(): StripeStub {
  return {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: {},
  };
}

function build(envOverrides: Record<string, unknown> = {}) {
  mockLoadEnv.mockReturnValue(envOverrides as never);

  const redisStore = new Map<string, string>();
  const prisma = {
    billingSubscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    runWithTenant: vi.fn(async (_tid: string, fn: (t: unknown) => unknown) => {
      const tx = { billingSubscription: prisma.billingSubscription };
      return fn(tx);
    }),
  } as unknown as ConstructorParameters<typeof BillingService>[0];
  const redis = {
    client: {
      set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
        if (redisStore.has(key)) return null;
        redisStore.set(key, value);
        return 'OK';
      }),
    },
  } as unknown as ConstructorParameters<typeof BillingService>[1];
  const svc = new BillingService(prisma, redis);
  return { svc, prisma, redis, redisStore };
}

function buildWithStripe(envOverrides: Record<string, unknown> = {}) {
  const h = build(envOverrides);
  const stripe = makeStripeStub();
  // Inject the stub regardless of whether the constructor saw STRIPE_SECRET_KEY.
  // The real SDK is never instantiated in tests — we always replace it here.
  (h.svc as unknown as { stripe: StripeStub }).stripe = stripe;
  return { ...h, stripe };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBreakers();
  // Restore default loadEnv + tenant-context return values after each test's
  // local override.
  mockLoadEnv.mockReturnValue({} as never);
  mockRequireTenantContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'OWNER' });
});

describe('BillingService constructor', () => {
  it('leaves stripe unconfigured when STRIPE_SECRET_KEY is absent', () => {
    const { svc } = build();
    expect((svc as unknown as { stripe: unknown }).stripe).toBeNull();
  });

  it('throws BadRequestException via the client getter when stripe is not configured', async () => {
    const { svc } = build();
    // The client getter is private; the public path that hits it is
    // createBillingPortalSession after a valid sub-with-customer is found.
    const stripePrivate = (svc as unknown as { stripe: unknown }).stripe;
    expect(stripePrivate).toBeNull();
    // Force a call into a method that uses `this.client`:
    // mock an existing sub with a customer so we cross the null-check
    // and reach the getter.
    vi.mocked((svc as never as { prisma: { billingSubscription: { findFirst: ReturnType<typeof vi.fn> } } }).prisma.billingSubscription.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      stripeCustomerId: 'cus_x',
    } as never);
    await expect(svc.createBillingPortalSession('https://app/return')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BillingService.getSubscription', () => {
  it('returns the existing subscription when one exists for the tenant', async () => {
    const { svc, prisma } = build();
    const existing = { tenantId: 'tenant-1', plan: 'growth', status: 'ACTIVE' };
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue(existing as never);

    const sub = await svc.getSubscription();
    expect(sub).toBe(existing);
    expect(prisma.billingSubscription.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });

  it('creates a 14-day TRIALING starter subscription when none exists', async () => {
    const { svc, prisma } = build();
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue(null);

    const created = { tenantId: 'tenant-1', plan: 'starter', status: 'TRIALING' };
    const create = vi.fn(async (_args: unknown) => created);
    // Override runWithTenant so create is on the tx, not findFirst.
    (prisma as unknown as { runWithTenant: ReturnType<typeof vi.fn> }).runWithTenant = vi.fn(
      async (_tid: string, fn: (t: unknown) => unknown) =>
        fn({ billingSubscription: { findFirst: prisma.billingSubscription.findFirst, create } }),
    );

    const sub = await svc.getSubscription();
    expect(sub).toBe(created);
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]?.[0] as unknown as { data: { tenantId: string; plan: string; status: string; trialEndsAt: Date } };
    expect(arg.data.tenantId).toBe('tenant-1');
    expect(arg.data.plan).toBe('starter');
    expect(arg.data.status).toBe('TRIALING');
    // trialEndsAt ~14 days in the future
    const diffMs = arg.data.trialEndsAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(13.5 * 86400_000);
    expect(diffMs).toBeLessThan(14.5 * 86400_000);
  });
});

describe('BillingService.createCheckoutSession', () => {
  beforeEach(() => {
    process.env['STRIPE_PRICE_STARTER'] = 'price_starter_xyz';
    process.env['STRIPE_PRICE_GROWTH'] = 'price_growth_xyz';
    process.env['STRIPE_PRICE_ENTERPRISE'] = 'price_ent_xyz';
  });

  it('rejects unknown plan with BadRequestException', async () => {
    const { svc, prisma } = buildWithStripe();
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      stripeCustomerId: 'cus_existing',
    } as never);

    await expect(
      svc.createCheckoutSession('platinum' as never, 'https://ok', 'https://cancel'),
    ).rejects.toThrow(/Unknown plan: platinum/);
  });

  it('uses existing stripeCustomerId without creating a new customer', async () => {
    const { svc, prisma, stripe } = buildWithStripe();
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      stripeCustomerId: 'cus_existing',
    } as never);
    stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/abc' });

    const result = await svc.createCheckoutSession('growth', 'https://ok', 'https://cancel');
    expect(result.url).toBe('https://checkout.stripe.com/abc');
    expect(stripe.customers.create).not.toHaveBeenCalled();
    const sessionArgs = stripe.checkout.sessions.create.mock.calls[0]?.[0] as unknown as {
      customer: string;
      mode: string;
      line_items: Array<{ price: string }>;
      success_url: string;
      cancel_url: string;
      metadata: { tenantId: string };
    };
    expect(sessionArgs.customer).toBe('cus_existing');
    expect(sessionArgs.mode).toBe('subscription');
    expect(sessionArgs.line_items[0]?.price).toBe('price_growth_xyz');
    expect(sessionArgs.metadata.tenantId).toBe('tenant-1');
  });

  it('creates a new Stripe customer when the tenant has none and persists the id', async () => {
    const { svc, prisma, stripe } = buildWithStripe();
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      stripeCustomerId: null,
    } as never);
    stripe.customers.create.mockResolvedValue({ id: 'cus_brand_new' });
    stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/new' });

    const update = vi.fn(async () => ({}));
    (prisma as unknown as { runWithTenant: ReturnType<typeof vi.fn> }).runWithTenant = vi.fn(
      async (_tid: string, fn: (t: unknown) => unknown) =>
        fn({ billingSubscription: { update, findFirst: prisma.billingSubscription.findFirst } }),
    );

    const result = await svc.createCheckoutSession('starter', 'https://ok', 'https://cancel');
    expect(result.url).toBe('https://checkout.stripe.com/new');
    expect(stripe.customers.create).toHaveBeenCalledWith({ metadata: { tenantId: 'tenant-1' } });
    expect(update).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      data: { stripeCustomerId: 'cus_brand_new' },
    });
    expect(stripe.checkout.sessions.create.mock.calls[0]?.[0]).toMatchObject({
      customer: 'cus_brand_new',
    });
  });
});

describe('BillingService.createBillingPortalSession', () => {
  it('returns the portal URL for a customer with a Stripe id', async () => {
    const { svc, prisma, stripe } = buildWithStripe();
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      stripeCustomerId: 'cus_portal',
    } as never);
    stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p_1' });

    const r = await svc.createBillingPortalSession('https://app/return');
    expect(r.url).toBe('https://billing.stripe.com/p_1');
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_portal',
      return_url: 'https://app/return',
    });
  });

  it('throws BadRequestException when the subscription has no Stripe customer linked', async () => {
    const { svc, prisma } = buildWithStripe();
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      stripeCustomerId: null,
    } as never);

    await expect(svc.createBillingPortalSession('https://app/return')).rejects.toThrow(/No Stripe customer linked/);
  });
});

describe('BillingService.handleWebhook', () => {
  function fakeReq(body: Buffer | string, signature = 't=1,v1=sig') {
    return {
      headers: { 'stripe-signature': signature },
      rawBody: Buffer.isBuffer(body) ? body : Buffer.from(body),
    } as never;
  }

  it('rejects when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const { svc } = buildWithStripe({}); // no STRIPE_WEBHOOK_SECRET in env
    await expect(svc.handleWebhook(fakeReq('{"id":"evt_1"}'))).rejects.toThrow(
      /STRIPE_WEBHOOK_SECRET not configured/,
    );
  });

  it('rejects when the signature is invalid (constructEvent throws)', async () => {
    const { svc, stripe } = buildWithStripe({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(svc.handleWebhook(fakeReq('{}', 'bad'))).rejects.toThrow(/Webhook signature invalid/);
  });

  it('processes the verified event through processStripeEvent', async () => {
    const { svc, stripe, prisma } = buildWithStripe({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const event = {
      id: 'evt_processed',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_x',
          customer: 'cus_x',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          items: { data: [{ price: { metadata: { plan: 'starter' } } }] },
          metadata: {},
        },
      },
    };
    stripe.webhooks.constructEvent.mockReturnValue(event);
    vi.mocked(prisma.billingSubscription.findFirst).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    const upsert = vi.fn(async () => ({}));
    (prisma as unknown as { runWithTenant: ReturnType<typeof vi.fn> }).runWithTenant = vi.fn(
      async (_tid: string, fn: (t: unknown) => unknown) =>
        fn({ billingSubscription: { upsert } }),
    );

    await svc.handleWebhook(fakeReq(JSON.stringify(event)));
    expect(stripe.webhooks.constructEvent).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });
});

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
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue(null);
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
    vi.mocked(h.prisma.billingSubscription.findUnique).mockResolvedValue({
      stripeCustomerId: 'cus_victim',
    } as never);
    const upsert = vi.fn();
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { upsert } } as unknown),
    ) as never;
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

  it('marks the subscription CANCELED on customer.subscription.deleted', async () => {
    const h = build();
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue({ tenantId: 'tenant-1' } as never);
    const update = vi.fn(async () => ({}));
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { update } } as unknown),
    ) as never;

    await h.svc.processStripeEvent({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_gone',
          customer: 'cus_to_cancel',
          status: 'canceled',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          items: { data: [{ price: { id: 'p' } }] },
          metadata: {},
        },
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      data: { status: 'CANCELED' },
    });
  });

  it('returns silently from customer.subscription.deleted when no tenant resolves', async () => {
    const h = build();
    vi.mocked(h.prisma.billingSubscription.findFirst).mockResolvedValue(null);
    vi.mocked(h.prisma.billingSubscription.findUnique).mockResolvedValue(null);
    const update = vi.fn();
    h.prisma.runWithTenant = vi.fn(async (_tid: string, fn: (t: unknown) => unknown) =>
      fn({ billingSubscription: { update } } as unknown),
    ) as never;

    await h.svc.processStripeEvent({
      id: 'evt_orphan_delete',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_orphan',
          customer: 'cus_unknown',
          status: 'canceled',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          items: { data: [{ price: { id: 'p' } }] },
          metadata: {},
        },
      },
    });
    expect(update).not.toHaveBeenCalled();
  });
});
