import { z } from 'zod';

export const CalendarProviderSchema = z.enum(['GOOGLE', 'OUTLOOK']);
export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;

export const CreateCalendarEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  location: z.string().trim().max(300).optional(),
  attendees: z.array(z.string().email()).max(50).optional(),
  subjectType: z.enum(['COMPANY', 'CONTACT', 'CLIENT']).optional(),
  subjectId: z.string().max(64).optional(),
});
export type CreateCalendarEventDto = z.infer<typeof CreateCalendarEventSchema>;

export const ListCalendarEventsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  subjectType: z.enum(['COMPANY', 'CONTACT', 'CLIENT']).optional(),
  subjectId: z.string().max(64).optional(),
});
export type ListCalendarEventsQueryDto = z.infer<typeof ListCalendarEventsQuerySchema>;
