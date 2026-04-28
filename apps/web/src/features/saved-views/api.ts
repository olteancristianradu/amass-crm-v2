import { api } from '@/lib/api';
import type { CreateSavedViewDto, SavedViewResource, UpdateSavedViewDto } from '@amass/shared';

export interface SavedView {
  id: string;
  resource: SavedViewResource;
  name: string;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const savedViewsApi = {
  list: (resource: SavedViewResource) =>
    api.get<SavedView[]>('/saved-views', { resource }),
  create: (dto: CreateSavedViewDto) => api.post<SavedView>('/saved-views', dto),
  update: (id: string, dto: UpdateSavedViewDto) => api.patch<SavedView>(`/saved-views/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/saved-views/${id}`),
};
