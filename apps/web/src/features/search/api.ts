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

  emailDraft: (input: { contactId: string; intent: string; tone?: 'formal' | 'friendly' | 'concise' }) =>
    api.post<EmailDraftResponse>('/ai/email/draft', input),

  parseIntent: (input: string) =>
    api.post<ParsedIntent>('/ai/intent', { input }),
};

export interface ParsedIntent {
  kind:
    | 'navigate'
    | 'create_company'
    | 'create_contact'
    | 'create_deal'
    | 'create_task'
    | 'search'
    | 'unknown';
  target?: string;
  params?: Record<string, string>;
  label: string;
}

export interface EmailDraftResponse {
  subject: string;
  body: string;
  tone: 'formal' | 'friendly' | 'concise';
  generatedAt: string;
}

export interface DealSuggestion {
  action: string;
  reasoning: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedAt: string;
}
