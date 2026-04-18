import { api } from '@/lib/api';

export type NotificationType =
  | 'REMINDER_FIRED'
  | 'DEAL_ASSIGNED'
  | 'TASK_ASSIGNED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_DECIDED'
  | 'INVOICE_OVERDUE'
  | 'MENTION'
  | 'SYSTEM';

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

export const notificationsApi = {
  listUnread: () => api.get<Notification[]>('/notifications', { unread: 'true' }),
  listAll: (limit = 20) => api.get<Notification[]>('/notifications', { limit }),
  markRead: (id: string) => api.patch<Notification>(`/notifications/${id}/read`),
  markAllRead: () => api.patch<void>('/notifications/read-all'),
};
