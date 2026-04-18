import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED' | 'CONVERTED';

export type LeadSource =
  | 'REFERRAL'
  | 'WEB'
  | 'COLD_CALL'
  | 'EVENT'
  | 'PARTNER'
  | 'SOCIAL'
  | 'OTHER';

export interface Lead {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  company?: string | null;
  source?: LeadSource | null;
  status: LeadStatus;
  score?: number | null;
  ownerId?: string | null;
  owner?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListLeadsQuery {
  status?: LeadStatus | LeadStatus[];
  source?: LeadSource;
  ownerId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ConvertLeadInput {
  /** If true, create a Company from the lead's company name. */
  createCompany?: boolean;
  /** If true, create a Contact linked to the company. */
  createContact?: boolean;
  /** Optionally link to an existing pipeline deal. */
  createDeal?: boolean;
  pipelineId?: string;
}

export const leadsApi = {
  list: (params?: ListLeadsQuery) =>
    api.get<CursorPage<Lead>>('/leads', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Lead>(`/leads/${id}`),
  create: (data: unknown) => api.post<Lead>('/leads', data),
  update: (id: string, data: unknown) => api.patch<Lead>(`/leads/${id}`, data),
  convert: (id: string, data: ConvertLeadInput) => api.post<Lead>(`/leads/${id}/convert`, data),
  delete: (id: string) => api.delete<void>(`/leads/${id}`),
};
