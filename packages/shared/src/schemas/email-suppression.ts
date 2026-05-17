import { z } from 'zod';
import { CuidSchema } from './common';

/**
 * Phase 1 / F1 — EmailSuppression schemas.
 *
 * Suppression list = GDPR-compliant "do not contact" list, stored as SHA-256
 * hash of the lowercase email (no plaintext PII). See migration
 * `20260518130000_phase1_email_suppressions` for the rationale.
 *
 * Three boundary surfaces:
 *  - Admin add (POST /email-suppressions): plaintext email in, hash + mask computed server-side
 *  - Admin list (GET /email-suppressions): paginated, only mask + reason returned (no email)
 *  - Admin delete (DELETE /email-suppressions/:id): removes a row, allows re-contact
 *
 * The pre-send check `isSuppressed(email)` is internal — no DTO needed.
 */

const trimmedEmail = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email('Must be a valid email address');

export const EmailSuppressionReasonSchema = z.enum([
  'USER_UNSUBSCRIBE',
  'BOUNCE_HARD',
  'SPAM_REPORT',
  'MANUAL_ADD',
  'COMPLAINT',
  'GLOBAL_BLOCK',
]);
export type EmailSuppressionReasonDto = z.infer<typeof EmailSuppressionReasonSchema>;

export const CreateEmailSuppressionSchema = z.object({
  email: trimmedEmail,
  // Free-text reason restricted to a known enum; admins can pick the rationale.
  // BOUNCE_HARD / SPAM_REPORT are usually written by the webhook handler,
  // not the admin UI, but no need to forbid here.
  reason: EmailSuppressionReasonSchema,
  // Optional auto-expiry. NULL = indefinite (sane default for unsub/bounce).
  // Validated as a JSON-stringified ISO timestamp on the wire.
  expiresAt: z.string().datetime().nullable().optional(),
  // Free-form provenance hint persisted in the source column for forensics.
  source: z.string().trim().max(128).optional(),
  notes: z.string().trim().max(1024).optional(),
});
export type CreateEmailSuppressionDto = z.infer<typeof CreateEmailSuppressionSchema>;

export const ListEmailSuppressionsQuerySchema = z.object({
  reason: EmailSuppressionReasonSchema.optional(),
  cursor: CuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListEmailSuppressionsQueryDto = z.infer<typeof ListEmailSuppressionsQuerySchema>;

/**
 * Admin-facing response. Never includes the raw email — only the masked
 * rendering (e.g. "j****@e****.com") computed at insert time.
 */
export const EmailSuppressionResponseSchema = z.object({
  id: CuidSchema,
  emailMasked: z.string(),
  reason: EmailSuppressionReasonSchema,
  source: z.string().nullable(),
  addedAt: z.string(),
  expiresAt: z.string().nullable(),
  addedById: z.string().nullable(),
  notes: z.string().nullable(),
});
export type EmailSuppressionResponse = z.infer<typeof EmailSuppressionResponseSchema>;
