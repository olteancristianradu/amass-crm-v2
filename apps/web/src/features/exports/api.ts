import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type ExportStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
export type ExportEntityType =
  | 'companies'
  | 'contacts'
  | 'deals'
  | 'invoices'
  | 'quotes'
  | 'activities';

export interface Export {
  id: string;
  tenantId: string;
  entityType: ExportEntityType;
  status: ExportStatus;
  rowCount?: number | null;
  storageKey?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestExportDto {
  entityType: ExportEntityType;
}

export interface DownloadUrlResponse {
  url: string;
}

export const exportsApi = {
  list: () => api.get<CursorPage<Export>>('/exports'),
  request: (dto: RequestExportDto) => api.post<Export>('/exports', dto),
  downloadUrl: (id: string) => api.get<DownloadUrlResponse>(`/exports/${id}/download`),
};
