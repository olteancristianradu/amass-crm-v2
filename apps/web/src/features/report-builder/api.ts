import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type ReportEntityType =
  | 'companies'
  | 'contacts'
  | 'deals'
  | 'invoices'
  | 'quotes'
  | 'activities';

export interface ReportTemplate {
  id: string;
  tenantId: string;
  name: string;
  entityType: ReportEntityType;
  columns: string[];
  limit: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateDto {
  name: string;
  entityType: ReportEntityType;
  columns: string[];
  limit: number;
}

export interface RunTemplateResponse {
  columns: string[];
  rows: Record<string, unknown>[];
}

export const reportBuilderApi = {
  listTemplates: () => api.get<CursorPage<ReportTemplate>>('/report-builder/templates'),
  createTemplate: (dto: CreateTemplateDto) =>
    api.post<ReportTemplate>('/report-builder/templates', dto),
  runTemplate: (id: string) =>
    api.post<RunTemplateResponse>(`/report-builder/templates/${id}/run`, {}),
  deleteTemplate: (id: string) => api.delete<void>(`/report-builder/templates/${id}`),
};
