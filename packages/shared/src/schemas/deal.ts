import { z } from 'zod';

/**
 * Deals live on the kanban. `value` is a string at the wire level so we
 * never lose precision going through JSON — the FE sends "1234.56" and
 * the API parses it into a Prisma Decimal. Currency is ISO-4217 ish but
 * we don't enforce a whitelist (Romanian SMBs occasionally quote in MDL
 * / UAH, so 3-letter uppercase is all we require).
 */
export const DealStatusSchema = z.enum(['OPEN', 'WON', 'LOST']);
export type DealStatusDto = z.infer<typeof DealStatusSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'value must be a decimal with up to 2 fraction digits');

export const CreateDealSchema = z.object({
  pipelineId: z.string().min(1).max(64),
  stageId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  value: decimalString.optional(),
  currency: z.string().trim().length(3).toUpperCase().default('RON'),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseAt: z.coerce.date().optional(),
  companyId: z.string().min(1).max(64).optional(),
  contactId: z.string().min(1).max(64).optional(),
  ownerId: z.string().min(1).max(64).optional(),
});
export type CreateDealDto = z.infer<typeof CreateDealSchema>;

/**
 * Update is patch-style. `stageId` is NOT included — moving a deal between
 * columns goes through the dedicated /deals/:id/move endpoint so the
 * service can recompute `status`, `closedAt`, and `orderInStage` atomically.
 */
export const UpdateDealSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    value: decimalString.nullable(),
    currency: z.string().trim().length(3).toUpperCase(),
    probability: z.number().int().min(0).max(100).nullable(),
    expectedCloseAt: z.coerce.date().nullable(),
    companyId: z.string().min(1).max(64).nullable(),
    contactId: z.string().min(1).max(64).nullable(),
    ownerId: z.string().min(1).max(64).nullable(),
    lostReason: z.string().trim().max(500).nullable(),
  })
  .partial();
export type UpdateDealDto = z.infer<typeof UpdateDealSchema>;

/**
 * Move a deal to a different stage (possibly in a different pipeline, though
 * the FE only exposes same-pipeline moves in S10). `orderInStage` is
 * optional — if omitted the service appends to the bottom of the target
 * column. `lostReason` is required by the service when the target stage
 * has type=LOST; we don't enforce it here because the stage type is only
 * known server-side.
 */
export const MoveDealSchema = z.object({
  stageId: z.string().min(1).max(64),
  orderInStage: z.number().int().min(0).max(1_000_000).optional(),
  lostReason: z.string().trim().max(500).optional(),
});
export type MoveDealDto = z.infer<typeof MoveDealSchema>;

export const ListDealsQuerySchema = z.object({
  pipelineId: z.string().min(1).max(64).optional(),
  stageId: z.string().min(1).max(64).optional(),
  status: DealStatusSchema.optional(),
  ownerId: z.string().min(1).max(64).optional(),
  companyId: z.string().min(1).max(64).optional(),
  contactId: z.string().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListDealsQueryDto = z.infer<typeof ListDealsQuerySchema>;
