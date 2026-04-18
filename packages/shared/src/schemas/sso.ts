import { z } from 'zod';

export const CreateSsoConfigSchema = z.object({
  idpSsoUrl: z.string().url(),
  idpCertificate: z.string().min(1),
  spEntityId: z.string().min(1).max(500),
  spPrivateKey: z.string().optional(),
  attrEmail: z.string().min(1).default('email'),
  attrFirstName: z.string().min(1).default('firstName'),
  attrLastName: z.string().min(1).default('lastName'),
  attrRole: z.string().optional(),
  isActive: z.boolean().default(true),
});
export type CreateSsoConfigDto = z.infer<typeof CreateSsoConfigSchema>;

export const UpdateSsoConfigSchema = CreateSsoConfigSchema.partial();
export type UpdateSsoConfigDto = z.infer<typeof UpdateSsoConfigSchema>;
