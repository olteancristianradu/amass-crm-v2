import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type CaseStatus = 'NEW' | 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type CasePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Case {
  id: string;
  number: number;
  subject: string;
  description?: string | null;
  status: CaseStatus;
  priority: CasePriority;
  companyId?: string | null;
  contactId?: string | null;
  assigneeId?: string | null;
  slaDeadline?: string | null;
  resolvedAt?: string | null;
  resolution?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCasesQuery {
  status?: CaseStatus;
  priority?: CasePriority;
  assigneeId?: string;
  companyId?: string;
  cursor?: string;
  limit?: number;
}

export const casesApi = {
  list: (params?: ListCasesQuery) =>
    api.get<CursorPage<Case>>('/cases', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Case>(`/cases/${id}`),
  create: (data: unknown) => api.post<Case>('/cases', data),
  update: (id: string, data: unknown) => api.patch<Case>(`/cases/${id}`, data),
  delete: (id: string) => api.delete<void>(`/cases/${id}`),
};
