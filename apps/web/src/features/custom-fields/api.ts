import { api } from '@/lib/api';

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';

export type CustomFieldEntityType =
  | 'COMPANY'
  | 'CONTACT'
  | 'CLIENT'
  | 'DEAL'
  | 'QUOTE'
  | 'INVOICE';

export interface CustomFieldDef {
  id: string;
  tenantId: string;
  entityType: CustomFieldEntityType;
  name: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isActive: boolean;
  options?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomFieldDto {
  entityType: CustomFieldEntityType;
  name: string;
  fieldType: CustomFieldType;
  isRequired?: boolean;
  options?: string[];
}

export const customFieldsApi = {
  list: (entityType?: CustomFieldEntityType) =>
    api.get<CustomFieldDef[]>('/custom-fields', entityType ? { entityType } : undefined),
  create: (dto: CreateCustomFieldDto) => api.post<CustomFieldDef>('/custom-fields', dto),
  toggle: (id: string, isActive: boolean) =>
    api.patch<CustomFieldDef>(`/custom-fields/${id}`, { isActive }),
};
