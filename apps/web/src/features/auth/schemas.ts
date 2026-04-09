import { z } from 'zod';

/**
 * Local copy of the auth DTO schemas. We keep these in apps/web rather than
 * importing from @amass/shared because auth DTOs aren't exported from the
 * shared package (they live in apps/api/src/modules/auth/dto.ts). When we
 * promote the auth schemas to @amass/shared, delete this file.
 */
export const LoginFormSchema = z.object({
  tenantSlug: z.string().trim().min(2, 'Cel puțin 2 caractere').max(64),
  email: z.string().email('Email invalid'),
  password: z.string().min(1, 'Parola este obligatorie'),
});
export type LoginFormValues = z.infer<typeof LoginFormSchema>;
