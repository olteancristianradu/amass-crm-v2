import { api } from '@/lib/api';

export interface TerritoryAssignment {
  id: string;
  territoryId: string;
  userId: string;
  createdAt: string;
}

export interface Territory {
  id: string;
  name: string;
  description?: string | null;
  counties: string[];
  industries: string[];
  createdAt: string;
  updatedAt: string;
  assignments: TerritoryAssignment[];
}

export const territoriesApi = {
  list: () => api.get<Territory[]>('/territories'),
  get: (id: string) => api.get<Territory>(`/territories/${id}`),
  create: (data: unknown) => api.post<Territory>('/territories', data),
  update: (id: string, data: unknown) => api.patch<Territory>(`/territories/${id}`, data),
  delete: (id: string) => api.delete<void>(`/territories/${id}`),
  assign: (id: string, userId: string) => api.post<TerritoryAssignment>(`/territories/${id}/assignments`, { userId }),
  unassign: (id: string, userId: string) => api.delete<void>(`/territories/${id}/assignments/${userId}`),
};
