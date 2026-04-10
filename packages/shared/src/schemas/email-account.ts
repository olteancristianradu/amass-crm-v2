import { z } from 'zod';

/**
 * Email account schemas. Each user can register one or more SMTP accounts
 * in the CRM. The SMTP password travels in plaintext from the FE to the API
 * (over TLS) but is stored encrypted (AES-256-GCM) — it never comes back
 * in API responses.
 */

export const CreateEmailAccountSchema = z.object({
  label: z.string().trim().min(1).max(100),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().trim().min(1).max(255),
  smtpPass: z.string().min(1).max(500), // plaintext on wire, encrypted at rest
  fromName: z.string().trim().min(1).max(200),
  fromEmail: z.string().trim().email().max(255),
  isDefault: z.boolean().default(false),
});
export type CreateEmailAccountDto = z.infer<typeof CreateEmailAccountSchema>;

export const UpdateEmailAccountSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    smtpHost: z.string().trim().min(1).max(255),
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpSecure: z.boolean(),
    smtpUser: z.string().trim().min(1).max(255),
    smtpPass: z.string().min(1).max(500),
    fromName: z.string().trim().min(1).max(200),
    fromEmail: z.string().trim().email().max(255),
    isDefault: z.boolean(),
  })
  .partial();
export type UpdateEmailAccountDto = z.infer<typeof UpdateEmailAccountSchema>;
