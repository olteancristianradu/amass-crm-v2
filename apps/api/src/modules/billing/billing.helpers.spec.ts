import { describe, expect, it } from 'vitest';
import {
  extractSubscriptionPatch,
  HANDLED_STRIPE_EVENTS,
  mapStripeStatus,
  StripeSubscriptionShape,
} from './billing.helpers';

describe('mapStripeStatus', () => {
  it('maps the happy-path statuses 1:1', () => {
    expect(mapStripeStatus('trialing')).toBe('TRIALING');
    expect(mapStripeStatus('active')).toBe('ACTIVE');
    expect(mapStripeStatus('canceled')).toBe('CANCELED');
    expect(mapStripeStatus('past_due')).toBe('PAST_DUE');
    expect(mapStripeStatus('unpaid')).toBe('UNPAID');
  });

  it('collapses incomplete → PAST_DUE and incomplete_expired → CANCELED', () => {
    expect(mapStripeStatus('incomplete')).toBe('PAST_DUE');
    expect(mapStripeStatus('incomplete_expired')).toBe('CANCELED');
  });

  it('defaults unknown statuses to ACTIVE (fail-open so checkout still works)', () => {
    expect(mapStripeStatus('some_future_status')).toBe('ACTIVE');
    expect(mapStripeStatus('')).toBe('ACTIVE');
  });
});

describe('extractSubscriptionPatch', () => {
  const base: StripeSubscriptionShape = {
    id: 'sub_123',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    customer: 'cus_abc',
    metadata: { tenantId: 'tenant-1' },
    items: { data: [{ price: { metadata: { plan: 'growth' } } }] },
  };

  it('extracts plan from the first line-item metadata', () => {
    const p = extractSubscriptionPatch(base);
    expect(p.plan).toBe('growth');
    expect(p.status).toBe('ACTIVE');
  });

  it('falls back to "starter" when plan metadata is missing', () => {
    const p = extractSubscriptionPatch({
      ...base,
      items: { data: [{ price: {} }] },
    });
    expect(p.plan).toBe('starter');
  });

  it('resolves customer-id whether it is a string or an object', () => {
    expect(extractSubscriptionPatch(base).stripeCustomerId).toBe('cus_abc');
    expect(
      extractSubscriptionPatch({ ...base, customer: { id: 'cus_obj' } }).stripeCustomerId,
    ).toBe('cus_obj');
  });

  it('converts unix seconds to JS Date', () => {
    const p = extractSubscriptionPatch(base);
    expect(p.currentPeriodStart.getTime()).toBe(1_700_000_000 * 1000);
    expect(p.currentPeriodEnd.getTime()).toBe(1_702_592_000 * 1000);
  });
});

describe('HANDLED_STRIPE_EVENTS', () => {
  it('covers exactly the three subscription lifecycle events', () => {
    expect(HANDLED_STRIPE_EVENTS).toEqual([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]);
  });
});
