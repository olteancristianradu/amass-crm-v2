import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type SmsDirection = 'INBOUND' | 'OUTBOUND';
export type SmsStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'UNDELIVERED';

export interface SmsMessage {
  id: string;
  tenantId: string;
  contactId?: string | null;
  direction: SmsDirection;
  fromNumber: string;
  toNumber: string;
  body: string;
  status: SmsStatus;
  twilioSid?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SendSmsDto {
  toNumber: string;
  body: string;
  contactId?: string;
}

export const smsApi = {
  list: (contactId?: string) =>
    api.get<CursorPage<SmsMessage>>('/sms', { contactId }),
  send: (dto: SendSmsDto) => api.post<SmsMessage>('/sms/send', dto),
};
