import { api } from '@/lib/api';

export interface DuplicateCandidate {
  id: string;
  name: string;
  vatNumber?: string | null;
  city?: string | null;
  similarity: number;
}

export interface FindDuplicatesResponse {
  candidates: DuplicateCandidate[];
}

export interface MergeCompaniesDto {
  survivorId: string;
  victimIds: string[];
}

export const duplicatesApi = {
  findCompanyDuplicates: (id: string) =>
    api.post<FindDuplicatesResponse>(`/duplicates/companies/${id}/find`, {}),
  mergeCompanies: (dto: MergeCompaniesDto) =>
    api.post<{ ok: boolean }>('/duplicates/companies/merge', dto),
};
