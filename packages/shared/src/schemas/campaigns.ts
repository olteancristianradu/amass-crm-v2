import { z } from 'zod';

/**
 * S58 Marketing Campaigns — track outreach (email/sms/whatsapp), conversions
 * and ROI per campaign. Optionally bound to a ContactSegment for targeting.
 */

export const CampaignStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED']);
export type CampaignStatusDto = z.infer<typeof CampaignStatusSchema>;

export const CampaignChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'MIXED']);
export type CampaignChannelDto = z.infer<typeof CampaignChannelSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be decimal with up to 2 fraction digits');

export const CreateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  channel: CampaignChannelSchema.default('EMAIL'),
  segmentId: z.string().min(1).max(64).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  budget: decimalString.optional(),
  currency: z.string().trim().length(3).toUpperCase().default('RON'),
  targetCount: z.coerce.number().int().nonnegative().default(0),
});
export type CreateCampaignDto = z.infer<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    status: CampaignStatusSchema,
    channel: CampaignChannelSchema,
    segmentId: z.string().min(1).max(64).nullable(),
    startDate: z.coerce.date().nullable(),
    endDate: z.coerce.date().nullable(),
    budget: decimalString.nullable(),
    targetCount: z.coerce.number().int().nonnegative(),
    sentCount: z.coerce.number().int().nonnegative(),
    conversions: z.coerce.number().int().nonnegative(),
    revenue: decimalString,
  })
  .partial();
export type UpdateCampaignDto = z.infer<typeof UpdateCampaignSchema>;

export const ListCampaignsQuerySchema = z.object({
  status: CampaignStatusSchema.optional(),
  channel: CampaignChannelSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCampaignsQueryDto = z.infer<typeof ListCampaignsQuerySchema>;
