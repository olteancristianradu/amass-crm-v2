import { api } from '@/lib/api';
import type { CursorPage, InvoiceCurrency, Project, ProjectStatus } from '@/lib/types';

export interface CreateProjectInput {
  companyId: string;
  dealId?: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string;
  endDate?: string;
  budget?: string;
  currency?: InvoiceCurrency;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  budget?: string | null;
  currency?: InvoiceCurrency;
}

export interface ListProjectsQuery {
  companyId?: string;
  status?: ProjectStatus;
  cursor?: string;
  limit?: number;
}

export const projectsApi = {
  list: (q: ListProjectsQuery = {}) =>
    api.get<CursorPage<Project>>('/projects', { ...q } as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (dto: CreateProjectInput) => api.post<Project>('/projects', dto),
  update: (id: string, dto: UpdateProjectInput) => api.patch<Project>(`/projects/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/projects/${id}`),
};
