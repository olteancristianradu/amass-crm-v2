import { api } from '@/lib/api';

export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppAccount {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppMessage {
  id: string;
  tenantId: string;
  accountId: string;
  direction: WhatsAppMessageDirection;
  fromNumber: string;
  toNumber: string;
  body: string;
  status: WhatsAppMessageStatus;
  wamid?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectAccountDto {
  phoneNumberId: string;
  displayPhoneNumber: string;
  accessToken: string;
  webhookVerifyToken: string;
  metaAppSecret: string;
}

export interface SendWhatsAppDto {
  subjectType: 'COMPANY' | 'CONTACT' | 'CLIENT';
  subjectId: string;
  toNumber: string;
  body: string;
}

export const whatsappApi = {
  listAccounts: () => api.get<WhatsAppAccount[]>('/whatsapp/accounts'),
  connectAccount: (dto: ConnectAccountDto) =>
    api.post<WhatsAppAccount>('/whatsapp/accounts', dto),
  listMessagesByAccount: (accountId: string) =>
    api.get<WhatsAppMessage[]>('/whatsapp/messages', { accountId }),
  listMessagesBySubject: (subjectType: SendWhatsAppDto['subjectType'], subjectId: string) =>
    api.get<WhatsAppMessage[]>('/whatsapp/messages', { subjectType, subjectId }),
  sendMessage: (dto: SendWhatsAppDto) =>
    api.post<WhatsAppMessage>('/whatsapp/messages', dto),
};
