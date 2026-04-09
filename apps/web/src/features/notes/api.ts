import { api } from '@/lib/api';
import type { Note, SubjectType, TimelinePage } from '@/lib/types';

export const notesApi = {
  list: (subjectType: SubjectType, subjectId: string) =>
    api.get<Note[]>(`/${subjectType}/${subjectId}/notes`),
  create: (subjectType: SubjectType, subjectId: string, body: string) =>
    api.post<Note>(`/${subjectType}/${subjectId}/notes`, { body }),
  update: (noteId: string, body: string) => api.patch<Note>(`/notes/${noteId}`, { body }),
  remove: (noteId: string) => api.delete<void>(`/notes/${noteId}`),
  timeline: (subjectType: SubjectType, subjectId: string, cursor?: string, limit = 20) =>
    api.get<TimelinePage>(`/${subjectType}/${subjectId}/timeline`, { cursor, limit }),
};
