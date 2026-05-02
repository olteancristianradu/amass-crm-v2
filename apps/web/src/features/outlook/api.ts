import { api } from '@/lib/api';

export interface OutlookStatus {
  connected: boolean;
  email?: string;
  displayName?: string;
}

export interface OutlookMessage {
  id: string;
  subject: string;
  from: { email: string; name: string };
  to: { email: string; name: string }[];
  receivedAt: string;
  bodyPreview: string;
  isRead: boolean;
  webLink?: string;
}

export const outlookApi = {
  status: () => api.get<OutlookStatus>('/outlook/status'),
  /** Returns the Microsoft auth URL to redirect the user to. */
  getConnectUrl: () => {
    const redirectUri = `${window.location.origin}/api/v1/outlook/callback`;
    const connectUrl = `/api/v1/outlook/connect?redirectUri=${encodeURIComponent(redirectUri)}`;
    return connectUrl;
  },
  messages: (limit?: number) => api.get<OutlookMessage[]>('/outlook/messages', limit ? { limit } : undefined),
  send: (dto: { to: string[]; cc?: string[]; subject: string; bodyHtml: string }) =>
    api.post<void>('/outlook/messages/send', dto),
  disconnect: () => api.delete<void>('/outlook/disconnect'),
};
