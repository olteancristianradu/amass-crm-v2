import { api } from '@/lib/api';

export type EventKind = 'CONFERENCE' | 'WEBINAR' | 'WORKSHOP' | 'MEETUP';
export type EventAttendeeStatus = 'INVITED' | 'REGISTERED' | 'ATTENDED' | 'CANCELLED';

export interface EventAttendee {
  id: string;
  eventId: string;
  contactId?: string | null;
  clientId?: string | null;
  email?: string | null;
  fullName?: string | null;
  status: EventAttendeeStatus;
  registeredAt?: string | null;
  attendedAt?: string | null;
}

export interface CrmEvent {
  id: string;
  name: string;
  description?: string | null;
  kind: EventKind;
  startAt: string;
  endAt: string;
  location?: string | null;
  capacity?: number | null;
  createdAt: string;
  updatedAt: string;
  attendees?: EventAttendee[];
}

export const eventsApi = {
  list: () => api.get<CrmEvent[]>('/events'),
  get: (id: string) => api.get<CrmEvent>(`/events/${id}`),
  create: (data: unknown) => api.post<CrmEvent>('/events', data),
  update: (id: string, data: unknown) => api.patch<CrmEvent>(`/events/${id}`, data),
  delete: (id: string) => api.delete<void>(`/events/${id}`),
  addAttendee: (id: string, data: unknown) => api.post<EventAttendee>(`/events/${id}/attendees`, data),
  updateAttendeeStatus: (id: string, attId: string, status: EventAttendeeStatus) =>
    api.patch<EventAttendee>(`/events/${id}/attendees/${attId}`, { status }),
  removeAttendee: (id: string, attId: string) => api.delete<void>(`/events/${id}/attendees/${attId}`),
};
