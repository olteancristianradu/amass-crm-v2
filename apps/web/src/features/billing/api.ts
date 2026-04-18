import { api } from '@/lib/api';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'PAUSED';

export interface Subscription {
  id: string;
  tenantId: string;
  plan: string;
  status: SubscriptionStatus;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId?: string | null;
}

export interface CheckoutResponse {
  /** Stripe Checkout session URL */
  url: string;
}

export interface PortalResponse {
  /** Stripe Customer Portal URL */
  url: string;
}

export const billingApi = {
  getSubscription: () => api.get<Subscription>('/billing/subscription'),
  createCheckout: () => api.post<CheckoutResponse>('/billing/checkout'),
  createPortal: () => api.post<PortalResponse>('/billing/portal'),
};
