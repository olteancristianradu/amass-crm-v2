import { z } from 'zod';

// ─── Triggers + subject types ────────────────────────────────────────────────

export const ApprovalPolicyTriggerSchema = z.enum([
  'QUOTE_ABOVE_VALUE',
  'DISCOUNT_ABOVE_PCT',
  'CONTRACT_VALUE_ABOVE',
  'EXPENSE_ABOVE_VALUE',
  'DEAL_DISCOUNT_ABOVE_PCT',
  'MANUAL',
]);
export type ApprovalPolicyTrigger = z.infer<typeof ApprovalPolicyTriggerSchema>;

export const ApprovalSubjectTypeSchema = z.enum([
  'QUOTE',
  'CONTRACT',
  'DEAL',
  'INVOICE',
  'EXPENSE',
]);
export type ApprovalSubjectType = z.infer<typeof ApprovalSubjectTypeSchema>;

// Per-trigger config — strict (extra keys rejected) so a payload like
// `{"__proto__":{"admin":true}}` cannot ride through to the trigger evaluator
// (mitigates T-APPR-T-06 prototype pollution).
const CurrencyCode = z.enum(['RON', 'EUR', 'USD', 'GBP', 'CHF']);

export const TriggerConfigQuoteAboveValueSchema = z.strictObject({
  threshold: z.number().positive(),
  currency: CurrencyCode.optional(),
});
export const TriggerConfigContractAboveValueSchema = z.strictObject({
  threshold: z.number().positive(),
  currency: CurrencyCode.optional(),
});
export const TriggerConfigExpenseAboveValueSchema = z.strictObject({
  threshold: z.number().positive(),
  currency: CurrencyCode.optional(),
});
export const TriggerConfigDiscountAboveSchema = z.strictObject({
  pct: z.number().min(0).max(100),
});
export const TriggerConfigManualSchema = z.strictObject({});

// Resolve the right strict schema by trigger.
export function triggerConfigSchemaFor(trigger: ApprovalPolicyTrigger) {
  switch (trigger) {
    case 'QUOTE_ABOVE_VALUE':
      return TriggerConfigQuoteAboveValueSchema;
    case 'CONTRACT_VALUE_ABOVE':
      return TriggerConfigContractAboveValueSchema;
    case 'EXPENSE_ABOVE_VALUE':
      return TriggerConfigExpenseAboveValueSchema;
    case 'DISCOUNT_ABOVE_PCT':
    case 'DEAL_DISCOUNT_ABOVE_PCT':
      return TriggerConfigDiscountAboveSchema;
    case 'MANUAL':
      return TriggerConfigManualSchema;
  }
}

// ─── Step definitions (snapshot into ApprovalRequest at creation) ────────────

// Per threat-models phase-2 T-APPR-D-01 — cap 10 steps, 1-5 approvers per step
// (T-APPR-D-01 mitigation; parallel cap 5).
const MAX_STEPS = 10;

export const StepConfigSchema = z
  .strictObject({
    order: z.number().int().min(0).max(MAX_STEPS - 1),
    name: z.string().trim().min(1).max(120).optional(),
    // exactly one of approverId / approverRole; matches DB CHECK
    // `approval_steps_approver_exclusive_chk`.
    approverId: z.string().min(1).max(64).optional(),
    approverRole: z.string().min(1).max(64).optional(),
    slaHours: z.number().int().min(1).max(168).optional(),
  })
  .refine(
    (s) => (s.approverId == null) !== (s.approverRole == null),
    { message: 'exactly one of approverId / approverRole required per step' },
  );
export type StepConfig = z.infer<typeof StepConfigSchema>;

export const StepsConfigSchema = z
  .array(StepConfigSchema)
  .min(1)
  .max(MAX_STEPS)
  .refine(
    (arr) => {
      // monotonic from 0, contiguous (no gaps). Each `order` index unique.
      const seen = new Set<number>();
      for (const s of arr) {
        if (seen.has(s.order)) return false;
        seen.add(s.order);
      }
      const sorted = [...seen].sort((a, b) => a - b);
      return sorted[0] === 0 && sorted[sorted.length - 1] === sorted.length - 1;
    },
    { message: 'steps must be 0-indexed, contiguous, no duplicates' },
  );
export type StepsConfig = z.infer<typeof StepsConfigSchema>;

// ─── Policy DTOs ─────────────────────────────────────────────────────────────

// Base shape lives on a plain ZodObject so we can derive `.partial()` for
// the update DTO. The require-one-of constraint between `stepsConfig` and
// `approverId` is enforced via a superRefine on the create schema.
const ApprovalPolicyBaseShape = z.object({
  name: z.string().trim().min(1).max(100),
  trigger: ApprovalPolicyTriggerSchema,
  // Per-trigger Zod schema validated at the service layer (we don't bind
  // the discriminated union here because the schema is a record — the
  // service runs triggerConfigSchemaFor(trigger).parse(config) for the
  // strict shape check).
  config: z.record(z.unknown()).default({}),
  // legacy single-approver shortcut; only honoured when stepsConfig is empty.
  approverId: z.string().min(1).max(64).optional(),
  subjectType: ApprovalSubjectTypeSchema.default('QUOTE'),
  stepsConfig: StepsConfigSchema.optional(),
  isActive: z.boolean().default(true),
});

export const CreateApprovalPolicySchema = ApprovalPolicyBaseShape.superRefine((p, ctx) => {
  if (p.stepsConfig == null && p.approverId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'one of stepsConfig (multi-step) or approverId (legacy) required',
    });
  }
});
export type CreateApprovalPolicyDto = z.infer<typeof CreateApprovalPolicySchema>;

export const UpdateApprovalPolicySchema = ApprovalPolicyBaseShape.partial();
export type UpdateApprovalPolicyDto = z.infer<typeof UpdateApprovalPolicySchema>;

// ─── Request DTOs ────────────────────────────────────────────────────────────

export const CreateApprovalRequestSchema = z.object({
  policyId: z.string().min(1).max(64),
  subjectType: ApprovalSubjectTypeSchema,
  subjectId: z.string().min(1).max(64),
  // Per-request SLA override in days (1-30). Each step still inherits its
  // own slaHours; this only sets the request-level `expiresAt` deadline
  // for terminal expiry (Story F2.4).
  slaDays: z.number().int().min(1).max(30).optional(),
});
export type CreateApprovalRequestDto = z.infer<typeof CreateApprovalRequestSchema>;

export const MakeApprovalDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(1000).optional(),
});
export type MakeApprovalDecisionDto = z.infer<typeof MakeApprovalDecisionSchema>;

export const WithdrawApprovalRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type WithdrawApprovalRequestDto = z.infer<typeof WithdrawApprovalRequestSchema>;

// NB: WITHDRAWN is captured intent-side in audit logs; the DB enum currently
// uses CANCELLED for the requester-initiated terminate (see service notes).
// Once the enum is extended to include WITHDRAWN, add it here.
export const ListApprovalRequestsSchema = z.object({
  status: z
    .enum(['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'])
    .optional(),
  subjectType: ApprovalSubjectTypeSchema.optional(),
  subjectId: z.string().min(1).max(64).optional(),
  quoteId: z.string().min(1).max(64).optional(),
  assignedToMe: z.coerce.boolean().optional(),
});
export type ListApprovalRequestsDto = z.infer<typeof ListApprovalRequestsSchema>;

export const APPROVAL_MAX_STEPS = MAX_STEPS;
