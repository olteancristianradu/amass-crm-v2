import { z } from 'zod';

export const CreateClientSchema = z.object({
  firstName: z.string().trim().min(1).max(128),
  lastName: z.string().trim().min(1).max(128),
  email: z.string().email().max(256).optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().max(64).optional(),
  mobile: z.string().trim().max(64).optional(),
  addressLine: z.string().trim().max(256).optional(),
  city: z.string().trim().max(128).optional(),
  county: z.string().trim().max(128).optional(),
  postalCode: z.string().trim().max(32).optional(),
  country: z.string().trim().max(64).optional(),
  notes: z.string().max(8000).optional(),
});
export type CreateClientDto = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = CreateClientSchema.partial();
export type UpdateClientDto = z.infer<typeof UpdateClientSchema>;
