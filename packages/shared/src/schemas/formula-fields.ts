import { z } from 'zod';
import { ValidationEntityTypeSchema } from './validation-rules';

export const FormulaReturnTypeSchema = z.enum(['STRING', 'NUMBER', 'BOOLEAN']);
export type FormulaReturnTypeDto = z.infer<typeof FormulaReturnTypeSchema>;

export const CreateFormulaFieldSchema = z.object({
  entityType: ValidationEntityTypeSchema,
  fieldName: z.string().trim().min(1).max(80).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  expression: z.string().trim().min(1).max(1000),
  returnType: FormulaReturnTypeSchema.default('STRING'),
  isActive: z.boolean().default(true),
});
export type CreateFormulaFieldDto = z.infer<typeof CreateFormulaFieldSchema>;

export const UpdateFormulaFieldSchema = CreateFormulaFieldSchema.partial();
export type UpdateFormulaFieldDto = z.infer<typeof UpdateFormulaFieldSchema>;

export const EvaluateFormulaSchema = z.object({
  expression: z.string().trim().min(1).max(1000),
  context: z.record(z.string(), z.unknown()),
});
export type EvaluateFormulaDto = z.infer<typeof EvaluateFormulaSchema>;
