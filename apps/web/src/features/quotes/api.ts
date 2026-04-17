import { api } from '@/lib/api';

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type QuoteCurrency = 'RON' | 'EUR' | 'USD';

export interface QuoteLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate?: string;
}

export interface QuoteLine {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  subtotal: string;
  vatAmount: string;
  total: string;
}

export interface Quote {
  id: string;
  tenantId: string;
  companyId: string;
  dealId?: string;
  number: string;
  title: string;
  issueDate: string;
  validUntil: string;
  subtotal: string;
  vatAmount: string;
  total: string;
  currency: QuoteCurrency;
  status: QuoteStatus;
  notes?: string;
  invoiceId?: string;
  createdAt: string;
  updatedAt: string;
  lines: QuoteLine[];
}

export interface CreateQuoteInput {
  companyId: string;
  dealId?: string;
  title: string;
  issueDate: string;
  validUntil: string;
  currency?: QuoteCurrency;
  notes?: string;
  lines: QuoteLineInput[];
}

export interface ListQuotesQuery {
  companyId?: string;
  dealId?: string;
  status?: QuoteStatus;
  cursor?: string;
  limit?: number;
}

export const quotesApi = {
  list: (q: ListQuotesQuery = {}) => {
    const params = new URLSearchParams();
    if (q.companyId) params.set('companyId', q.companyId);
    if (q.dealId) params.set('dealId', q.dealId);
    if (q.status) params.set('status', q.status);
    if (q.cursor) params.set('cursor', q.cursor);
    if (q.limit) params.set('limit', String(q.limit));
    return api.get<{ data: Quote[]; nextCursor: string | null }>(`/quotes?${params.toString()}`);
  },

  get: (id: string) => api.get<Quote>(`/quotes/${id}`),

  create: (dto: CreateQuoteInput) => api.post<Quote>('/quotes', dto),

  update: (id: string, dto: Partial<CreateQuoteInput>) =>
    api.patch<Quote>(`/quotes/${id}`, dto),

  changeStatus: (id: string, status: QuoteStatus) =>
    api.post<Quote>(`/quotes/${id}/status`, { status }),

  convertToInvoice: (id: string, dto: { issueDate: string; dueDate: string; series?: string }) =>
    api.post<{ invoiceId: string }>(`/quotes/${id}/convert`, dto),

  remove: (id: string) => api.delete<void>(`/quotes/${id}`),
};
