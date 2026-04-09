import { api } from '@/lib/api';
import type { Contact, CursorPage } from '@/lib/types';

export const contactsApi = {
  list: (cursor?: string, limit = 20, q?: string) =>
    api.get<CursorPage<Contact>>('/contacts', { cursor, limit, q }),
  get: (id: string) => api.get<Contact>(`/contacts/${id}`),
  create: (dto: Partial<Contact>) => api.post<Contact>('/contacts', dto),
  update: (id: string, dto: Partial<Contact>) => api.patch<Contact>(`/contacts/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/contacts/${id}`),
};
