import { api } from '@/lib/api';
import type { Client, CursorPage } from '@/lib/types';

export const clientsApi = {
  list: (cursor?: string, limit = 20, q?: string) =>
    api.get<CursorPage<Client>>('/clients', { cursor, limit, q }),
  get: (id: string) => api.get<Client>(`/clients/${id}`),
  create: (dto: Partial<Client>) => api.post<Client>('/clients', dto),
  update: (id: string, dto: Partial<Client>) => api.patch<Client>(`/clients/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/clients/${id}`),
};
