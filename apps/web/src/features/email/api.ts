import { api } from '@/lib/api';
import type { CursorPage, EmailAccount, EmailMessage, SubjectType } from '@/lib/types';

export interface CreateEmailAccountInput {
  label: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  fromName: string;
  fromEmail: string;
  isDefault?: boolean;
}

export interface UpdateEmailAccountInput {
  label?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  fromName?: string;
  fromEmail?: string;
  isDefault?: boolean;
}

export interface SendEmailInput {
  accountId: string;
  subjectType: SubjectType;
  subjectId: string;
  toAddresses: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export const emailAccountsApi = {
  list: () => api.get<EmailAccount[]>('/email/accounts'),
  create: (dto: CreateEmailAccountInput) => api.post<EmailAccount>('/email/accounts', dto),
  update: (id: string, dto: UpdateEmailAccountInput) =>
    api.patch<EmailAccount>(`/email/accounts/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/email/accounts/${id}`),
};

export const emailMessagesApi = {
  list: (params: {
    subjectType?: SubjectType;
    subjectId?: string;
    accountId?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  }) => api.get<CursorPage<EmailMessage>>('/email/messages', params),
  get: (id: string) => api.get<EmailMessage>(`/email/messages/${id}`),
  send: (dto: SendEmailInput) => api.post<EmailMessage>('/email/send', dto),
};
