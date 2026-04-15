import { api } from '@/lib/api';
import type {
  CursorPage,
  Invoice,
  InvoiceCurrency,
  InvoiceStatus,
  Payment,
  PaymentMethod,
} from '@/lib/types';

export interface CreateInvoiceLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate?: string;
}

export interface CreateInvoiceInput {
  companyId: string;
  dealId?: string;
  series?: string;
  number?: number;
  issueDate: string;
  dueDate: string;
  currency?: InvoiceCurrency;
  notes?: string;
  lines: CreateInvoiceLineInput[];
}

export interface UpdateInvoiceInput {
  issueDate?: string;
  dueDate?: string;
  currency?: InvoiceCurrency;
  notes?: string | null;
  lines?: CreateInvoiceLineInput[];
}

export interface ListInvoicesQuery {
  companyId?: string;
  dealId?: string;
  status?: InvoiceStatus;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface CreatePaymentInput {
  amount: string;
  paidAt: string;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
}

export const invoicesApi = {
  list: (q: ListInvoicesQuery = {}) =>
    api.get<CursorPage<Invoice>>('/invoices', { ...q } as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Invoice>(`/invoices/${id}`),
  create: (dto: CreateInvoiceInput) => api.post<Invoice>('/invoices', dto),
  update: (id: string, dto: UpdateInvoiceInput) => api.patch<Invoice>(`/invoices/${id}`, dto),
  changeStatus: (id: string, status: InvoiceStatus) =>
    api.post<Invoice>(`/invoices/${id}/status`, { status }),
  remove: (id: string) => api.delete<void>(`/invoices/${id}`),

  listPayments: (invoiceId: string) =>
    api.get<Payment[]>(`/invoices/${invoiceId}/payments`),
  createPayment: (invoiceId: string, dto: CreatePaymentInput) =>
    api.post<Payment>(`/invoices/${invoiceId}/payments`, dto),
  removePayment: (paymentId: string) => api.delete<void>(`/payments/${paymentId}`),
};
