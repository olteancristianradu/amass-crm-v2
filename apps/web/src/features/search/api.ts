import { api } from '@/lib/api';
import type { SearchResult, EntityType } from '@/lib/types';

export interface SemanticSearchResponse {
  results: SearchResult[];
}

export const searchApi = {
  semantic: (q: string, limit = 10) =>
    api.get<SemanticSearchResponse>('/ai/search', { q, limit }),

  similar: (type: EntityType, id: string, limit = 5) =>
    api.get<SemanticSearchResponse>(`/ai/similar/${type}/${id}`, { limit }),

  dealSuggest: (dealId: string) =>
    api.post<DealSuggestion>(`/ai/deals/${dealId}/suggest`, {}),
};

export interface DealSuggestion {
  action: string;
  reasoning: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedAt: string;
}
