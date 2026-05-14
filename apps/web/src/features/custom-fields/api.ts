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
  // snake_case machine name (e.g. "segment_client"). Must match
  // /^[a-z][a-z0-9_]*$/ per the BE schema.
  name: string;
  // Human-readable label shown in the UI (e.g. "Segment client").
  label: string;
  fieldType: CustomFieldType;
  isRequired?: boolean;
  options?: string[];
}

// Backend mounts the resource under /custom-fields/defs (defs vs values
// sub-paths inside one controller). FE must hit /defs explicitly.
export const customFieldsApi = {
  list: (entityType?: CustomFieldEntityType) =>
    api.get<CustomFieldDef[]>('/custom-fields/defs', entityType ? { entityType } : undefined),
  create: (dto: CreateCustomFieldDto) => api.post<CustomFieldDef>('/custom-fields/defs', dto),
  toggle: (id: string, isActive: boolean) =>
    api.patch<CustomFieldDef>(`/custom-fields/defs/${id}`, { isActive }),
};
