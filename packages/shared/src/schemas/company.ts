import { z } from 'zod';

export const CompanySizeSchema = z.enum(['MICRO', 'SMALL', 'MEDIUM', 'LARGE']);

export const CreateCompanySchema = z.object({
  name: z.string().trim().min(1).max(256),
  vatNumber: z.string().trim().max(64).optional(),
  registrationNumber: z.string().trim().max(64).optional(),
  industry: z.string().trim().max(128).optional(),
  size: CompanySizeSchema.optional(),
  website: z.string().url().max(256).optional().or(z.literal('').transform(() => undefined)),
  email: z.string().email().max(256).optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().max(64).optional(),
  addressLine: z.string().trim().max(256).optional(),
  city: z.string().trim().max(128).optional(),
  county: z.string().trim().max(128).optional(),
  postalCode: z.string().trim().max(32).optional(),
  country: z.string().trim().max(64).optional(),
  notes: z.string().max(8000).optional(),
});
export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>;

export const UpdateCompanySchema = CreateCompanySchema.partial();
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>;
