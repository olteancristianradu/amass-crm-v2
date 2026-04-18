import { z } from 'zod';

export const ApprovalPolicyTriggerSchema = z.enum(['QUOTE_ABOVE_VALUE', 'DISCOUNT_ABOVE_PCT']);
export type ApprovalPolicyTrigger = z.infer<typeof ApprovalPolicyTriggerSchema>;

export const CreateApprovalPolicySchema = z.object({
  name: z.string().trim().min(1).max(100),
  trigger: ApprovalPolicyTriggerSchema,
  // QUOTE_ABOVE_VALUE: { threshold: number, currency: 'RON'|'EUR'|'USD' }
  // DISCOUNT_ABOVE_PCT: { pct: number }
  config: z.record(z.unknown()),
  approverId: z.string().min(1).max(64).optional(),
  isActive: z.boolean().default(true),
});
export type CreateApprovalPolicyDto = z.infer<typeof CreateApprovalPolicySchema>;

export const UpdateApprovalPolicySchema = CreateApprovalPolicySchema.partial();
export type UpdateApprovalPolicyDto = z.infer<typeof UpdateApprovalPolicySchema>;

export const MakeApprovalDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(1000).optional(),
});
export type MakeApprovalDecisionDto = z.infer<typeof MakeApprovalDecisionSchema>;
