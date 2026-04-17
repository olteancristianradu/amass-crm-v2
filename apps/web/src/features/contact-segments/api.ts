import { api } from '@/lib/api';

export type FilterOperator =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with'
  | 'is_empty' | 'is_not_empty' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'is_true' | 'is_false';

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value?: string | number | boolean;
}

export interface FilterGroup {
  op: 'AND' | 'OR';
  rules: (FilterRule | FilterGroup)[];
}

export interface ContactSegment {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  filterJson: FilterGroup;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentPreviewContact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  isDecider: boolean;
  companyId?: string;
}

export const contactSegmentsApi = {
  list: () => api.get<ContactSegment[]>('/contact-segments'),
  get: (id: string) => api.get<ContactSegment>(`/contact-segments/${id}`),
  create: (dto: { name: string; description?: string; filterJson: FilterGroup }) =>
    api.post<ContactSegment>('/contact-segments', dto),
  update: (id: string, dto: Partial<{ name: string; description: string; filterJson: FilterGroup }>) =>
    api.patch<ContactSegment>(`/contact-segments/${id}`, dto),
  preview: (id: string, limit = 50) =>
    api.get<SegmentPreviewContact[]>(`/contact-segments/${id}/preview?limit=${limit}`),
  remove: (id: string) => api.delete<void>(`/contact-segments/${id}`),
};
