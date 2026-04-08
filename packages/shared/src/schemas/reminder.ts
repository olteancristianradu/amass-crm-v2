import { z } from 'zod';

/**
 * Polymorphic reminders attached to Company / Contact / Client. Mirrors the
 * Reminder model in apps/api/prisma/schema.prisma.
 *
 * `remindAt` MUST be in the future. We accept ISO strings (FE) or Date
 * objects (server-side calls) and coerce both into a Date for the API.
 * The "future" check happens at the schema layer so that the BullMQ
 * `delay` we compute downstream is never negative.
 */
export const ReminderStatusSchema = z.enum(['PENDING', 'FIRED', 'DISMISSED', 'CANCELLED']);
export type ReminderStatusDto = z.infer<typeof ReminderStatusSchema>;

const futureDate = z.coerce
  .date({ invalid_type_error: 'remindAt must be a valid date' })
  .refine((d) => d.getTime() > Date.now(), { message: 'remindAt must be in the future' });

export const CreateReminderSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).optional(),
  remindAt: futureDate,
});
export type CreateReminderDto = z.infer<typeof CreateReminderSchema>;

/**
 * Update is a strict subset — `status` is changed via the dedicated
 * /dismiss endpoint, not by patching it directly. This keeps the
 * BullMQ job-cancel side effect impossible to forget.
 */
export const UpdateReminderSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(4000).nullable(),
    remindAt: futureDate,
  })
  .partial();
export type UpdateReminderDto = z.infer<typeof UpdateReminderSchema>;
