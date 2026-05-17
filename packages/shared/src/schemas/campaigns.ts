import { z } from 'zod';

/**
 * S58 Marketing Campaigns — track outreach (email/sms/whatsapp), conversions
 * and ROI per campaign. Optionally bound to a ContactSegment for targeting.
 *
 * Phase 1 (F2 — drag-drop builder) extends the schema with:
 *   - subject / fromName / fromAddress / replyTo / previewText (envelope)
 *   - templateJson (block tree validated by a discriminated-union allow-list
 *     so an attacker cannot smuggle iframe/script blocks past the API —
 *     threat T-CB-T-01)
 *   - scheduledAt (BullMQ delayed dispatch)
 *   - recipientFilter (segment snapshot — RLS still applies at materialise
 *     time so cross-tenant contactIds resolve to zero rows)
 */

export const CampaignStatusSchema = z.enum([
  'DRAFT',
  // Phase 1 — distinct from ACTIVE: SCHEDULED means a delayed BullMQ job
  // exists and the dispatcher will pick it up at scheduledAt. ACTIVE is for
  // long-running drip campaigns or after dispatch starts mid-batch.
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  // Phase 1 — explicit cancel state so audit can distinguish "user pulled
  // the plug" from "campaign finished sending".
  'CANCELLED',
]);
export type CampaignStatusDto = z.infer<typeof CampaignStatusSchema>;

export const CampaignChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'MIXED']);
export type CampaignChannelDto = z.infer<typeof CampaignChannelSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be decimal with up to 2 fraction digits');

// ─── Template block tree (T-CB-T-01: per-block allow-list) ───────────────
//
// Discriminated union on `type`. Anything outside this list is rejected by
// Zod with VALIDATION_ERROR — the FE cannot persist `iframe`, `script`, or
// other arbitrary block kinds. Each block schema is `.strict()` so unknown
// properties (e.g. `srcdoc`, `onclick`) are also rejected, not silently
// dropped.

const blockBase = z.object({
  id: z.string().min(1).max(64),
  align: z.enum(['left', 'center', 'right']).optional(),
});

const headingBlock = blockBase.extend({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string().max(500),
}).strict();

const paragraphBlock = blockBase.extend({
  type: z.literal('paragraph'),
  text: z.string().max(5000),
}).strict();

const imageBlock = blockBase.extend({
  type: z.literal('image'),
  // Only http(s); javascript: / data: rejected at parse time.
  src: z.string().url().refine((v) => /^https?:\/\//i.test(v), {
    message: 'image src must be http(s)',
  }),
  alt: z.string().max(200).optional(),
  width: z.number().int().positive().max(2000).optional(),
}).strict();

const buttonBlock = blockBase.extend({
  type: z.literal('button'),
  url: z.string().url().refine((v) => /^https?:\/\//i.test(v), {
    message: 'button url must be http(s)',
  }),
  label: z.string().min(1).max(120),
}).strict();

const dividerBlock = blockBase.extend({
  type: z.literal('divider'),
}).strict();

const spacerBlock = blockBase.extend({
  type: z.literal('spacer'),
  height: z.number().int().positive().max(200).default(16),
}).strict();

const socialBlock = blockBase.extend({
  type: z.literal('social'),
  links: z
    .array(
      z
        .object({
          network: z.enum(['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'youtube']),
          url: z.string().url().refine((v) => /^https?:\/\//i.test(v), {
            message: 'social url must be http(s)',
          }),
        })
        .strict(),
    )
    .max(10),
}).strict();

export const BlockSchema = z.discriminatedUnion('type', [
  headingBlock,
  paragraphBlock,
  imageBlock,
  buttonBlock,
  dividerBlock,
  spacerBlock,
  socialBlock,
]);
export type BlockDto = z.infer<typeof BlockSchema>;

export const TemplateJsonSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(BlockSchema).max(200),
  })
  .strict();
export type TemplateJsonDto = z.infer<typeof TemplateJsonSchema>;

// ─── Personalization token allow-list (T-CB-T-02) ────────────────────────
//
// Tokens are interpolated at render time. We restrict the set both to
// prevent leaking arbitrary CRM fields into outbound mail and to keep the
// renderer's responsibilities small. Anything else (e.g. {{customField}}
// or {{tenant.apiKey}}) fails server-side validation; the renderer cannot
// be tricked into reaching past this allow-list.
export const ALLOWED_PERSONALIZATION_TOKENS = [
  'contact.firstName',
  'contact.lastName',
  'contact.fullName',
  'contact.email',
  'contact.company.name',
  'deal.amount',
  'deal.title',
  'tenant.name',
  'campaign.name',
  'sender.firstName',
  'sender.fullName',
  'unsubscribeUrl',
  'currentYear',
] as const;
export type AllowedToken = (typeof ALLOWED_PERSONALIZATION_TOKENS)[number];

const TOKEN_REGEX = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Scan a string for `{{...}}` tokens and return any tokens NOT in the
 * allow-list. Empty array = template is safe.
 *
 * Whitespace inside the braces is tolerated (`{{ contact.firstName }}`),
 * matching what the renderer will accept. The match is intentionally
 * permissive on the inside so the *only* gatekeeper is the allow-list set.
 */
export function findUnknownTokens(text: string): string[] {
  const unknown: string[] = [];
  const allowed = new Set<string>(ALLOWED_PERSONALIZATION_TOKENS);
  const matches = text.matchAll(TOKEN_REGEX);
  for (const m of matches) {
    const token = m[1];
    if (!allowed.has(token)) unknown.push(token);
  }
  return unknown;
}

/**
 * Walks a TemplateJson tree and returns every unknown token across all
 * text-bearing blocks. Used by CreateCampaignSchema/UpdateCampaignSchema's
 * `superRefine` so the rejection happens at the request boundary.
 */
export function findUnknownTokensInTemplate(t: TemplateJsonDto): string[] {
  const out: string[] = [];
  for (const block of t.blocks) {
    if (block.type === 'heading' || block.type === 'paragraph') {
      out.push(...findUnknownTokens(block.text));
    }
    if (block.type === 'button') {
      out.push(...findUnknownTokens(block.label));
      out.push(...findUnknownTokens(block.url));
    }
    if (block.type === 'image' && block.alt) {
      out.push(...findUnknownTokens(block.alt));
    }
  }
  return out;
}

// ─── Recipient filter (segment snapshot) ─────────────────────────────────
//
// We accept a small structured filter, validated `.strict()`. At
// materialisation time the service runs the query inside runWithTenant() so
// any contactId from another tenant simply doesn't resolve — RLS does the
// heavy lifting (T-CB-S-02 cross-tenant include).
export const RecipientFilterSchema = z
  .object({
    contactIds: z.array(z.string().min(1).max(64)).max(10_000).optional(),
    leadIds: z.array(z.string().min(1).max(64)).max(10_000).optional(),
    clientIds: z.array(z.string().min(1).max(64)).max(10_000).optional(),
    segmentId: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (f) => Boolean(f.contactIds?.length || f.leadIds?.length || f.clientIds?.length || f.segmentId),
    { message: 'recipientFilter must include at least one of: contactIds, leadIds, clientIds, segmentId' },
  );
export type RecipientFilterDto = z.infer<typeof RecipientFilterSchema>;

// ─── Phase 1 builder envelope fields ─────────────────────────────────────

const builderEnvelope = {
  subject: z.string().trim().min(1).max(998).optional(),
  fromName: z.string().trim().min(1).max(80).optional(),
  // RFC 5321 limits the local-part + domain to 320 chars total.
  fromAddress: z.string().trim().email().max(320).optional(),
  replyTo: z.string().trim().email().max(320).optional(),
  previewText: z.string().trim().max(255).optional(),
  templateJson: TemplateJsonSchema.optional(),
  scheduledAt: z.coerce.date().optional(),
  recipientFilter: RecipientFilterSchema.optional(),
};

export const CreateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    channel: CampaignChannelSchema.default('EMAIL'),
    segmentId: z.string().min(1).max(64).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    budget: decimalString.optional(),
    currency: z.string().trim().length(3).toUpperCase().default('RON'),
    targetCount: z.coerce.number().int().nonnegative().default(0),
    ...builderEnvelope,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.templateJson) return;
    const unknown = findUnknownTokensInTemplate(data.templateJson);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateJson'],
        message: `unknown personalization tokens: ${unknown.join(', ')}`,
      });
    }
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
    ...builderEnvelope,
  })
  .partial()
  .strict()
  .superRefine((data, ctx) => {
    if (!data.templateJson) return;
    const unknown = findUnknownTokensInTemplate(data.templateJson);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateJson'],
        message: `unknown personalization tokens: ${unknown.join(', ')}`,
      });
    }
  });
export type UpdateCampaignDto = z.infer<typeof UpdateCampaignSchema>;

export const ListCampaignsQuerySchema = z.object({
  status: CampaignStatusSchema.optional(),
  channel: CampaignChannelSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCampaignsQueryDto = z.infer<typeof ListCampaignsQuerySchema>;

// ─── Phase 1 — endpoint-specific bodies ──────────────────────────────────

export const SendTestCampaignSchema = z
  .object({
    email: z.string().trim().email().max(320),
  })
  .strict();
export type SendTestCampaignDto = z.infer<typeof SendTestCampaignSchema>;

export const ScheduleCampaignSchema = z
  .object({
    scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now() - 60_000, {
      // 60s grace window so a clock skew between FE and BE doesn't reject
      // a "now-ish" schedule.
      message: 'scheduledAt must be in the future',
    }),
  })
  .strict();
export type ScheduleCampaignDto = z.infer<typeof ScheduleCampaignSchema>;
