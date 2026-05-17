import { z } from 'zod';

/**
 * Phase 1 — F2 campaign builder. Per-recipient send attribution.
 *
 * One CampaignRecipient row per (campaign, subject) materialised at
 * schedule time. Carries the HMAC tracking token (rotated per send) used
 * by the pixel / click / unsubscribe endpoints to attribute events back
 * to *this* recipient without leaking the email address in URLs.
 */

export const CampaignRecipientStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'FAILED',
  'SKIPPED',
]);
export type CampaignRecipientStatusDto = z.infer<typeof CampaignRecipientStatusSchema>;

export const CampaignRecipientSubjectTypeSchema = z.enum([
  'COMPANY',
  'CONTACT',
  'CLIENT',
  'LEAD',
]);
export type CampaignRecipientSubjectTypeDto = z.infer<
  typeof CampaignRecipientSubjectTypeSchema
>;

export const ListCampaignRecipientsQuerySchema = z.object({
  status: CampaignRecipientStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCampaignRecipientsQueryDto = z.infer<
  typeof ListCampaignRecipientsQuerySchema
>;
