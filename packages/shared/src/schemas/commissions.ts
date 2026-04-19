import { z } from 'zod';

export const CreateCommissionPlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  percent: z.coerce.number().min(0).max(100),
  isActive: z.boolean().default(true),
});
export type CreateCommissionPlanDto = z.infer<typeof CreateCommissionPlanSchema>;

export const UpdateCommissionPlanSchema = CreateCommissionPlanSchema.partial();
export type UpdateCommissionPlanDto = z.infer<typeof UpdateCommissionPlanSchema>;

export const ComputeCommissionsSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  planId: z.string().min(1).max(64),
});
export type ComputeCommissionsDto = z.infer<typeof ComputeCommissionsSchema>;

export const MarkCommissionPaidSchema = z.object({
  paidAt: z.coerce.date().default(() => new Date()),
});
export type MarkCommissionPaidDto = z.infer<typeof MarkCommissionPaidSchema>;
