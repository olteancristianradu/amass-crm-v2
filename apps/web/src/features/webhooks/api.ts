import { api } from '@/lib/api';

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookEndpointDto {
  url: string;
  events: string[];
}

export const webhooksApi = {
  listEndpoints: () => api.get<WebhookEndpoint[]>('/webhooks/endpoints'),
  createEndpoint: (dto: CreateWebhookEndpointDto) =>
    api.post<WebhookEndpoint>('/webhooks/endpoints', dto),
  updateEndpoint: (id: string, dto: Partial<CreateWebhookEndpointDto & { isActive: boolean }>) =>
    api.patch<WebhookEndpoint>(`/webhooks/endpoints/${id}`, dto),
  deleteEndpoint: (id: string) => api.delete<void>(`/webhooks/endpoints/${id}`),
};

/** All event types the system can emit. */
export const WEBHOOK_EVENTS = [
  'company.created',
  'company.updated',
  'company.deleted',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'invoice.created',
  'invoice.issued',
  'invoice.paid',
  'invoice.overdue',
  'quote.created',
  'quote.sent',
  'quote.accepted',
  'quote.rejected',
  'call.completed',
  'call.transcribed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
