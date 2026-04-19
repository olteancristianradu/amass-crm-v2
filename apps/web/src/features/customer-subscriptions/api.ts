import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type CustomerSubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';

export interface CustomerSubscription {
  id: string;
  companyId: string;
  name: string;
  plan?: string | null;
  status: CustomerSubscriptionStatus;
  mrr: string;
  currency: string;
  startDate: string;
  endDate?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MrrSnapshot {
  mrr: number;
  arr: number;
  activeCount: number;
  cancelledLast30d: number;
  churnRate: number;
  currency: string;
  byPlan: { plan: string; mrr: number; count: number }[];
}

export const customerSubsApi = {
  list: (params?: { status?: CustomerSubscriptionStatus; companyId?: string; limit?: number }) =>
    api.get<CursorPage<CustomerSubscription>>('/customer-subscriptions', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<CustomerSubscription>(`/customer-subscriptions/${id}`),
  create: (data: unknown) => api.post<CustomerSubscription>('/customer-subscriptions', data),
  update: (id: string, data: unknown) => api.patch<CustomerSubscription>(`/customer-subscriptions/${id}`, data),
  delete: (id: string) => api.delete<void>(`/customer-subscriptions/${id}`),
  snapshot: () => api.get<MrrSnapshot>('/customer-subscriptions/snapshot'),
};
