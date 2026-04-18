import { api } from '@/lib/api';

export type CalendarProvider = 'GOOGLE' | 'OUTLOOK';

export interface CalendarIntegration {
  id: string;
  tenantId: string;
  userId: string;
  provider: CalendarProvider;
  accountEmail: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  tenantId: string;
  integrationId: string;
  externalId?: string | null;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  attendees?: string[] | null;
  location?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectCalendarResponse {
  /** OAuth redirect URL to send the user to. */
  url: string;
}

export interface CreateEventDto {
  integrationId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  attendees?: string[];
  location?: string;
}

export const calendarApi = {
  listIntegrations: () => api.get<CalendarIntegration[]>('/calendar/integrations'),
  connect: (provider: CalendarProvider) =>
    api.get<ConnectCalendarResponse>(`/calendar/connect/${provider}`),
  listEvents: (from: string, to: string) =>
    api.get<CalendarEvent[]>('/calendar/events', { from, to }),
  createEvent: (dto: CreateEventDto) => api.post<CalendarEvent>('/calendar/events', dto),
};
