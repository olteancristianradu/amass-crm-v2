import { api } from '@/lib/api';
import type { Call, CursorPage, PhoneNumber, SubjectType } from '@/lib/types';

export interface InitiateCallInput {
  subjectType: SubjectType;
  subjectId: string;
  toNumber: string;
  phoneNumberId?: string;
}

export interface CreatePhoneNumberInput {
  twilioSid: string;
  number: string;
  label?: string;
  userId?: string;
  isDefault?: boolean;
}

export interface UpdatePhoneNumberInput {
  label?: string;
  number?: string;
  userId?: string;
  isDefault?: boolean;
}

export interface ListCallsParams {
  subjectType?: SubjectType;
  subjectId?: string;
  userId?: string;
  status?: string;
  direction?: string;
  cursor?: string;
  limit?: number;
}

export const callsApi = {
  list: (params: ListCallsParams) =>
    api.get<CursorPage<Call>>('/calls', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Call>(`/calls/${id}`),
  initiate: (dto: InitiateCallInput) => api.post<Call>('/calls/initiate', dto),
};

export const phoneNumbersApi = {
  list: () => api.get<PhoneNumber[]>('/phone-numbers'),
  get: (id: string) => api.get<PhoneNumber>(`/phone-numbers/${id}`),
  create: (dto: CreatePhoneNumberInput) => api.post<PhoneNumber>('/phone-numbers', dto),
  update: (id: string, dto: UpdatePhoneNumberInput) =>
    api.patch<PhoneNumber>(`/phone-numbers/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/phone-numbers/${id}`),
};
