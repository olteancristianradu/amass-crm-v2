import { api } from '@/lib/api';

export type SequenceStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface SequenceStepInput {
  order: number;
  delayDays: number;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export interface EmailSequence {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: SequenceStatus;
  createdAt: string;
  steps: SequenceStep[];
  _count?: { enrollments: number };
}

export interface SequenceStep {
  id: string;
  order: number;
  delayDays: number;
  subject: string;
  bodyHtml: string;
}

export interface SequenceEnrollment {
  id: string;
  toEmail: string;
  contactId?: string;
  currentStep: number;
  status: 'ACTIVE' | 'COMPLETED' | 'UNSUBSCRIBED' | 'FAILED';
  enrolledAt: string;
  nextSendAt?: string;
}

export const emailSequencesApi = {
  list: (status?: SequenceStatus) => {
    const qs = status ? `?status=${status}` : '';
    return api.get<EmailSequence[]>(`/email-sequences${qs}`);
  },
  get: (id: string) => api.get<EmailSequence>(`/email-sequences/${id}`),
  create: (dto: { name: string; description?: string; steps: SequenceStepInput[] }) =>
    api.post<EmailSequence>('/email-sequences', dto),
  update: (id: string, dto: Partial<{ name: string; description: string; steps: SequenceStepInput[] }>) =>
    api.patch<EmailSequence>(`/email-sequences/${id}`, dto),
  activate: (id: string) => api.post<EmailSequence>(`/email-sequences/${id}/activate`, {}),
  pause: (id: string) => api.post<EmailSequence>(`/email-sequences/${id}/pause`, {}),
  archive: (id: string) => api.delete<void>(`/email-sequences/${id}`),
  enroll: (id: string, dto: { sequenceId: string; toEmail: string; contactId?: string }) =>
    api.post<SequenceEnrollment>(`/email-sequences/${id}/enroll`, dto),
  listEnrollments: (id: string) =>
    api.get<SequenceEnrollment[]>(`/email-sequences/${id}/enrollments`),
};
