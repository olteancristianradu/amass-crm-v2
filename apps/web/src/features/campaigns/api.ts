import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
export type CampaignChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'MIXED';

export interface Campaign {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  channel: CampaignChannel;
  segmentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budget?: string | null;
  currency: string;
  targetCount: number;
  sentCount: number;
  conversions: number;
  revenue: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListCampaignsQuery {
  status?: CampaignStatus;
  channel?: CampaignChannel;
  cursor?: string;
  limit?: number;
}

export const campaignsApi = {
  list: (params?: ListCampaignsQuery) =>
    api.get<CursorPage<Campaign>>('/campaigns', params as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Campaign>(`/campaigns/${id}`),
  create: (data: unknown) => api.post<Campaign>('/campaigns', data),
  update: (id: string, data: unknown) => api.patch<Campaign>(`/campaigns/${id}`, data),
  delete: (id: string) => api.delete<void>(`/campaigns/${id}`),
};
