import { z } from 'zod';
import { CuidSchema } from './common';

export const CreateContactSchema = z.object({
  companyId: CuidSchema.optional(),
  firstName: z.string().trim().min(1).max(128),
  lastName: z.string().trim().min(1).max(128),
  jobTitle: z.string().trim().max(128).optional(),
  email: z.string().email().max(256).optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().max(64).optional(),
  mobile: z.string().trim().max(64).optional(),
  isDecider: z.boolean().optional(),
  notes: z.string().max(8000).optional(),
});
export type CreateContactDto = z.infer<typeof CreateContactSchema>;

export const UpdateContactSchema = CreateContactSchema.partial();
export type UpdateContactDto = z.infer<typeof UpdateContactSchema>;
