import { z } from 'zod';

export const EmailToneSchema = z.enum(['formal', 'friendly', 'concise']);
export type EmailTone = z.infer<typeof EmailToneSchema>;

export const EmailDraftRequestSchema = z.object({
  contactId: z.string().min(1),
  intent: z.string().trim().min(3).max(500),
  tone: EmailToneSchema.optional(),
});
export type EmailDraftRequestDto = z.infer<typeof EmailDraftRequestSchema>;
