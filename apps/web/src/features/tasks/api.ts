import { api } from '@/lib/api';
import type { CursorPage, SubjectType, Task, TaskPriority } from '@/lib/types';

export interface CreateTaskInput {
  title: string;
  description?: string;
  dueAt?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  dealId?: string;
  subjectType?: SubjectType;
  subjectId?: string;
}

export interface ListTasksQuery {
  status?: 'OPEN' | 'DONE';
  assigneeId?: string;
  dealId?: string;
  subjectType?: SubjectType;
  subjectId?: string;
  dueBefore?: string;
  cursor?: string;
  limit?: number;
}

export const tasksApi = {
  list: (query: ListTasksQuery = {}) =>
    api.get<CursorPage<Task>>('/tasks', query as Record<string, string | number | undefined>),
  listMine: (query: Omit<ListTasksQuery, 'assigneeId'> = {}) =>
    api.get<CursorPage<Task>>('/tasks/me', query as Record<string, string | number | undefined>),
  findOne: (id: string) => api.get<Task>(`/tasks/${id}`),
  create: (dto: CreateTaskInput) => api.post<Task>('/tasks', dto),
  update: (id: string, dto: Partial<CreateTaskInput>) => api.patch<Task>(`/tasks/${id}`, dto),
  complete: (id: string) => api.post<Task>(`/tasks/${id}/complete`),
  reopen: (id: string) => api.post<Task>(`/tasks/${id}/reopen`),
  remove: (id: string) => api.delete<void>(`/tasks/${id}`),
};
