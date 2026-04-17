import { z } from 'zod';

export const SequenceStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export type SequenceStatus = z.infer<typeof SequenceStatusSchema>;

export const SequenceStepInputSchema = z.object({
  order: z.number().int().min(0),
  delayDays: z.number().int().min(0).max(365).default(0),
  subject: z.string().trim().min(1).max(256),
  bodyHtml: z.string().min(1).max(50000),
  bodyText: z.string().max(50000).optional(),
});
export type SequenceStepInputDto = z.infer<typeof SequenceStepInputSchema>;

export const CreateEmailSequenceSchema = z.object({
  name: z.string().trim().min(1).max(256),
  description: z.string().trim().max(1000).optional(),
  steps: z.array(SequenceStepInputSchema).min(1).max(20),
});
export type CreateEmailSequenceDto = z.infer<typeof CreateEmailSequenceSchema>;

export const UpdateEmailSequenceSchema = CreateEmailSequenceSchema.partial();
export type UpdateEmailSequenceDto = z.infer<typeof UpdateEmailSequenceSchema>;

export const EnrollContactSchema = z.object({
  sequenceId: z.string().min(1),
  toEmail: z.string().email(),
  contactId: z.string().optional(),
});
export type EnrollContactDto = z.infer<typeof EnrollContactSchema>;
