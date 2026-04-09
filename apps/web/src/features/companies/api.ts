import { api } from '@/lib/api';
import type { Company, CursorPage } from '@/lib/types';

export const companiesApi = {
  list: (cursor?: string, limit = 20, q?: string) =>
    api.get<CursorPage<Company>>('/companies', { cursor, limit, q }),
  get: (id: string) => api.get<Company>(`/companies/${id}`),
  create: (dto: Partial<Company>) => api.post<Company>('/companies', dto),
  update: (id: string, dto: Partial<Company>) => api.patch<Company>(`/companies/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/companies/${id}`),
};
