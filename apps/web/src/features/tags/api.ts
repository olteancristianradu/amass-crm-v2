import { api } from '@/lib/api';
import type { Tag, TagEntityType } from '@/lib/types';

export const tagsApi = {
  list: (params?: { entityType?: TagEntityType; entityId?: string }) =>
    api.get<Tag[]>('/tags', params),
  /** Returns { [entityId]: Tag[] } for a batch of entity IDs of the same type. */
  batchByEntities: (entityType: TagEntityType, entityIds: string[]) =>
    api.get<Record<string, Tag[]>>('/tags/batch', { entityType, entityIds }),
  create: (dto: { name: string; color?: string }) =>
    api.post<Tag>('/tags', dto),
  update: (id: string, dto: { name?: string; color?: string }) =>
    api.patch<Tag>(`/tags/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/tags/${id}`),
  assign: (tagId: string, dto: { entityType: TagEntityType; entityId: string }) =>
    api.post<void>(`/tags/${tagId}/assign`, dto),
  unassign: (tagId: string, entityId: string) =>
    api.delete<void>(`/tags/${tagId}/assign/${entityId}`),
};
