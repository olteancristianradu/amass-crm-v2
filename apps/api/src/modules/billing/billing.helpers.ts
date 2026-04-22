/**
 * Pure helpers extracted from BillingService so they can be unit-tested
 * without spinning up Stripe / Prisma. Mirrors the pattern used by
 * `invoices.helpers.ts`, `calls.helpers.ts`, and `deals.helpers.ts`.
 */

export type BillingStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID';

/**
 * Stripe subscription status → our internal status enum. Stripe emits a
 * handful of states we collapse: `incomplete` is treated as `PAST_DUE`
 * (customer started checkout but didn't finish the first payment) and
 * `incomplete_expired` as `CANCELED` (the 23h window lapsed).
 */
export function mapStripeStatus(stripeStatus: string): BillingStatus {
  const map: Record<string, BillingStatus> = {
    trialing: 'TRIALING',
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    canceled: 'CANCELED',
    unpaid: 'UNPAID',
    incomplete: 'PAST_DUE',
    incomplete_expired: 'CANCELED',
  };
  return map[stripeStatus] ?? 'ACTIVE';
}

export interface StripeSubscriptionShape {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_start: number;
  current_period_end: number;
  customer: string | { id: string };
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { metadata?: Record<string, string> } }> };
}

export interface SubscriptionPatch {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan: string;
  status: BillingStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

/**
 * Normalise a Stripe subscription object into the shape we upsert into
 * `billing_subscriptions`. Pulls plan name from the first line-item's
 * price metadata (falls back to `starter`) and resolves the
 * customer-id union to a plain string.
 */
export function extractSubscriptionPatch(sub: StripeSubscriptionShape): SubscriptionPatch {
  return {
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    plan: sub.items.data[0]?.price.metadata?.['plan'] ?? 'starter',
    status: mapStripeStatus(sub.status),
    currentPeriodStart: new Date(sub.current_period_start * 1000),
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

/** Which Stripe event types we actually handle. */
export const HANDLED_STRIPE_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
