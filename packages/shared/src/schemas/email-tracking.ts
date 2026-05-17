import { z } from 'zod';
import { CuidSchema } from './common';

/**
 * Phase 1 / F1 — Email tracking admin/observability schemas.
 *
 * The public open-pixel + click endpoints are unauthenticated and do NOT
 * use Zod validation (they accept whatever the recipient mail client sends
 * and either match an HMAC or drop). This file exposes the AUTHED surfaces:
 *  - stats lookup (already used by the FE)
 *  - PII-purge admin trigger (NEW in Phase 1 — manual replay if cron lags)
 *
 * The unsubscribe public endpoint (GET /u/:token) has no DTO either; the
 * token is validated as HMAC and rendered via a fixed HTML template.
 */

export const EmailTrackingStatsResponseSchema = z.object({
  messageId: CuidSchema,
  opens: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  lastOpenedAt: z.string().datetime().nullable(),
  trackingDisabled: z.boolean(),
});
export type EmailTrackingStatsResponse = z.infer<typeof EmailTrackingStatsResponseSchema>;

/**
 * Manual PII purge trigger payload (OWNER/ADMIN only). Lets the admin force
 * a purge of all email_tracks rows older than `olderThanDays` whose
 * pii_hashed_at is still NULL. Same logic as the daily cron; surfaced so the
 * admin can replay if a cron crashed or the cluster was offline.
 */
export const TriggerEmailTracksPiiPurgeSchema = z.object({
  olderThanDays: z.coerce.number().int().min(1).max(3650).default(90),
});
export type TriggerEmailTracksPiiPurgeDto = z.infer<typeof TriggerEmailTracksPiiPurgeSchema>;
