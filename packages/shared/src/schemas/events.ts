import { z } from 'zod';

export const EventKindSchema = z.enum(['CONFERENCE', 'WEBINAR', 'WORKSHOP', 'MEETUP']);
export type EventKindDto = z.infer<typeof EventKindSchema>;

export const EventAttendeeStatusSchema = z.enum(['INVITED', 'REGISTERED', 'ATTENDED', 'CANCELLED']);
export type EventAttendeeStatusDto = z.infer<typeof EventAttendeeStatusSchema>;

export const CreateEventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  kind: EventKindSchema.default('CONFERENCE'),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  location: z.string().trim().max(300).optional(),
  capacity: z.coerce.number().int().positive().optional(),
}).refine(d => d.endAt > d.startAt, { message: 'endAt must be after startAt', path: ['endAt'] });
export type CreateEventDto = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable(),
  kind: EventKindSchema,
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  location: z.string().trim().max(300).nullable(),
  capacity: z.coerce.number().int().positive().nullable(),
}).partial();
export type UpdateEventDto = z.infer<typeof UpdateEventSchema>;

export const CreateAttendeeSchema = z.object({
  contactId: z.string().min(1).max(64).optional(),
  clientId: z.string().min(1).max(64).optional(),
  email: z.string().email().optional(),
  fullName: z.string().trim().max(200).optional(),
  status: EventAttendeeStatusSchema.default('INVITED'),
});
export type CreateAttendeeDto = z.infer<typeof CreateAttendeeSchema>;

export const UpdateAttendeeStatusSchema = z.object({
  status: EventAttendeeStatusSchema,
});
export type UpdateAttendeeStatusDto = z.infer<typeof UpdateAttendeeStatusSchema>;
