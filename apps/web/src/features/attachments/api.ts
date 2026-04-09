import { api } from '@/lib/api';
import type { Attachment, SubjectType } from '@/lib/types';

export interface PresignResponse {
  storageKey: string;
  uploadUrl: string;
}

export interface PresignDto {
  fileName: string;
  mimeType: string;
  size: number;
}

export const attachmentsApi = {
  list: (subjectType: SubjectType, subjectId: string) =>
    api.get<Attachment[]>(`/${subjectType}/${subjectId}/attachments`),
  presign: (subjectType: SubjectType, subjectId: string, dto: PresignDto) =>
    api.post<PresignResponse>(`/${subjectType}/${subjectId}/attachments/presign`, dto),
  complete: (
    subjectType: SubjectType,
    subjectId: string,
    dto: PresignDto & { storageKey: string },
  ) => api.post<Attachment>(`/${subjectType}/${subjectId}/attachments`, dto),
  download: (id: string) => api.get<{ url: string }>(`/attachments/${id}/download`),
  remove: (id: string) => api.delete<void>(`/attachments/${id}`),
};

/**
 * Two-step upload driver: presign → PUT bytes → complete. The API never
 * sees the file. Errors from any phase bubble up to the caller so the UI
 * can surface them.
 */
export async function uploadAttachment(
  subjectType: SubjectType,
  subjectId: string,
  file: File,
): Promise<Attachment> {
  const presign = await attachmentsApi.presign(subjectType, subjectId, {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  });
  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`MinIO upload failed: ${putRes.status}`);
  }
  return attachmentsApi.complete(subjectType, subjectId, {
    storageKey: presign.storageKey,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  });
}
