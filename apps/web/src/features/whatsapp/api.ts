import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppAccount {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  /** accessToken is never returned in full — masked by the backend */
  displayName?: string | null;
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
  accessToken: string;
  verifyToken: string;
}

export interface SendWhatsAppDto {
  toNumber: string;
  body: string;
  accountId?: string;
}

export const whatsappApi = {
  listAccounts: () => api.get<CursorPage<WhatsAppAccount>>('/whatsapp/accounts'),
  connectAccount: (dto: ConnectAccountDto) =>
    api.post<WhatsAppAccount>('/whatsapp/accounts', dto),
  listMessages: (accountId: string) =>
    api.get<CursorPage<WhatsAppMessage>>('/whatsapp/messages', { accountId }),
  sendMessage: (dto: SendWhatsAppDto) =>
    api.post<WhatsAppMessage>('/whatsapp/send', dto),
};
