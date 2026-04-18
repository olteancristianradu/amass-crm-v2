import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type ContractStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'TERMINATED'
  | 'RENEWED';

export interface Contract {
  id: string;
  tenantId: string;
  title: string;
  companyId?: string | null;
  company?: { id: string; name: string } | null;
  value?: string | null;
  currency: string;
  status: ContractStatus;
  startDate?: string | null;
  endDate?: string | null;
  autoRenew: boolean;
  notes?: string | null;
  storageKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListContractsQuery {
  status?: ContractStatus;
  companyId?: string;
  cursor?: string;
  limit?: number;
}

export const contractsApi = {
  list: (params?: ListContractsQuery) =>
    api.get<CursorPage<Contract>>('/contracts', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Contract>(`/contracts/${id}`),
  create: (data: unknown) => api.post<Contract>('/contracts', data),
  update: (id: string, data: unknown) => api.patch<Contract>(`/contracts/${id}`, data),
  delete: (id: string) => api.delete<void>(`/contracts/${id}`),
};
