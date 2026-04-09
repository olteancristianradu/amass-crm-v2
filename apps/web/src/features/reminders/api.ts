import { api } from '@/lib/api';
import type { CursorPage, Reminder, SubjectType } from '@/lib/types';

export interface CreateReminderInput {
  title: string;
  body?: string;
  remindAt: string; // ISO string, must be in the future
}

export const remindersApi = {
  listForSubject: (subjectType: SubjectType, subjectId: string) =>
    api.get<Reminder[]>(`/${subjectType}/${subjectId}/reminders`),
  create: (subjectType: SubjectType, subjectId: string, dto: CreateReminderInput) =>
    api.post<Reminder>(`/${subjectType}/${subjectId}/reminders`, dto),
  listMine: (cursor?: string, limit = 20) =>
    api.get<CursorPage<Reminder>>('/reminders/me', { cursor, limit }),
  update: (id: string, dto: { title?: string; body?: string; remindAt?: string }) =>
    api.patch<Reminder>(`/reminders/${id}`, dto),
  dismiss: (id: string) => api.post<Reminder>(`/reminders/${id}/dismiss`),
  remove: (id: string) => api.delete<void>(`/reminders/${id}`),
};
