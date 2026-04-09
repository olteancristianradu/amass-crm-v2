import { api } from '@/lib/api';
import type { CursorPage, Deal } from '@/lib/types';

export interface CreateDealInput {
  pipelineId: string;
  stageId: string;
  title: string;
  description?: string;
  value?: string;
  currency?: string;
  probability?: number;
  expectedCloseAt?: string;
  companyId?: string;
  contactId?: string;
  ownerId?: string;
}

export interface MoveDealInput {
  stageId: string;
  orderInStage?: number;
  lostReason?: string;
}

export interface ListDealsQuery {
  pipelineId?: string;
  stageId?: string;
  status?: 'OPEN' | 'WON' | 'LOST';
  ownerId?: string;
  companyId?: string;
  contactId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export const dealsApi = {
  list: (query: ListDealsQuery = {}) => api.get<CursorPage<Deal>>('/deals', query as Record<string, string | number | undefined>),
  findOne: (id: string) => api.get<Deal>(`/deals/${id}`),
  create: (dto: CreateDealInput) => api.post<Deal>('/deals', dto),
  update: (id: string, dto: Partial<CreateDealInput>) => api.patch<Deal>(`/deals/${id}`, dto),
  move: (id: string, dto: MoveDealInput) => api.post<Deal>(`/deals/${id}/move`, dto),
  remove: (id: string) => api.delete<void>(`/deals/${id}`),
};
