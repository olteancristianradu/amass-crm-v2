import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';

export interface OrderItem {
  id: string;
  productId?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

export interface Order {
  id: string;
  number: number;
  companyId: string;
  quoteId?: string | null;
  status: OrderStatus;
  totalAmount: string;
  currency: string;
  notes?: string | null;
  confirmedAt?: string | null;
  fulfilledAt?: string | null;
  cancelledAt?: string | null;
  items?: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ListOrdersQuery {
  status?: OrderStatus;
  companyId?: string;
  cursor?: string;
  limit?: number;
}

export const ordersApi = {
  list: (params?: ListOrdersQuery) =>
    api.get<CursorPage<Order>>('/orders', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Order>(`/orders/${id}`),
  create: (data: unknown) => api.post<Order>('/orders', data),
  update: (id: string, data: unknown) => api.patch<Order>(`/orders/${id}`, data),
  delete: (id: string) => api.delete<void>(`/orders/${id}`),
};
