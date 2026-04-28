import { z } from 'zod';

/**
 * Local copy of the auth DTO schemas. We keep these in apps/web rather than
 * importing from @amass/shared because auth DTOs aren't exported from the
 * shared package (they live in apps/api/src/modules/auth/dto.ts). When we
 * promote the auth schemas to @amass/shared, delete this file.
 */
export const LoginFormSchema = z.object({
  email: z.string().email('Email invalid'),
  password: z.string().min(1, 'Parola este obligatorie'),
});
export type LoginFormValues = z.infer<typeof LoginFormSchema>;

// Tenant slug rules mirror the API: lowercase letters, digits, hyphen.
const tenantSlugRule = z
  .string()
  .trim()
  .min(2, 'Cel puțin 2 caractere')
  .max(64, 'Maxim 64 caractere')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Doar litere mici, cifre și liniuțe (ex: acme-srl)');

export const RegisterFormSchema = z
  .object({
    tenantSlug: tenantSlugRule,
    tenantName: z
      .string()
      .trim()
      .min(2, 'Cel puțin 2 caractere')
      .max(128, 'Maxim 128 caractere'),
    fullName: z
      .string()
      .trim()
      .min(2, 'Cel puțin 2 caractere')
      .max(128, 'Maxim 128 caractere'),
    email: z.string().email('Email invalid'),
    password: z.string().min(8, 'Minim 8 caractere').max(128, 'Maxim 128 caractere'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parolele nu coincid',
  });
export type RegisterFormValues = z.infer<typeof RegisterFormSchema>;

export const ForgotPasswordFormSchema = z.object({
  tenantSlug: tenantSlugRule,
  email: z.string().email('Email invalid'),
});
export type ForgotPasswordFormValues = z.infer<typeof ForgotPasswordFormSchema>;

export const ResetPasswordFormSchema = z
  .object({
    newPassword: z.string().min(8, 'Minim 8 caractere').max(128, 'Maxim 128 caractere'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parolele nu coincid',
  });
export type ResetPasswordFormValues = z.infer<typeof ResetPasswordFormSchema>;
