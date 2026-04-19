import { z } from 'zod';

export const ValidationEntityTypeSchema = z.enum([
  'COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'LEAD', 'CASE', 'ORDER',
]);
export type ValidationEntityTypeDto = z.infer<typeof ValidationEntityTypeSchema>;

export const ValidationOperatorSchema = z.enum([
  'REGEX', 'MIN_LENGTH', 'MAX_LENGTH', 'EQUALS', 'NOT_EQUALS',
]);
export type ValidationOperatorDto = z.infer<typeof ValidationOperatorSchema>;

export const CreateValidationRuleSchema = z.object({
  entityType: ValidationEntityTypeSchema,
  field: z.string().trim().min(1).max(80),
  operator: ValidationOperatorSchema,
  value: z.string().min(0).max(500),
  errorMessage: z.string().trim().min(1).max(500),
  isActive: z.boolean().default(true),
});
export type CreateValidationRuleDto = z.infer<typeof CreateValidationRuleSchema>;

export const UpdateValidationRuleSchema = CreateValidationRuleSchema.partial();
export type UpdateValidationRuleDto = z.infer<typeof UpdateValidationRuleSchema>;
