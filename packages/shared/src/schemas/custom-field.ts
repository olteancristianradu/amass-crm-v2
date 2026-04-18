import { z } from 'zod';

export const CustomFieldEntityTypeSchema = z.enum(['COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'QUOTE', 'INVOICE']);
export type CustomFieldEntityType = z.infer<typeof CustomFieldEntityTypeSchema>;

export const CustomFieldTypeSchema = z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT']);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CreateCustomFieldDefSchema = z.object({
  entityType: CustomFieldEntityTypeSchema,
  fieldType: CustomFieldTypeSchema,
  // snake_case immutable key
  name: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, 'name must start with letter and use snake_case'),
  label: z.string().trim().min(1).max(100),
  options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  isRequired: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});
export type CreateCustomFieldDefDto = z.infer<typeof CreateCustomFieldDefSchema>;

export const UpdateCustomFieldDefSchema = CreateCustomFieldDefSchema
  .omit({ entityType: true, name: true, fieldType: true })
  .extend({ isActive: z.boolean().optional() })
  .partial();
export type UpdateCustomFieldDefDto = z.infer<typeof UpdateCustomFieldDefSchema>;

export const SetCustomFieldValueSchema = z.object({
  fieldDefId: z.string().min(1).max(64),
  value: z.string().max(2000),
});
export type SetCustomFieldValueDto = z.infer<typeof SetCustomFieldValueSchema>;

export const BulkSetCustomFieldValuesSchema = z.object({
  values: z.array(SetCustomFieldValueSchema).max(50),
});
export type BulkSetCustomFieldValuesDto = z.infer<typeof BulkSetCustomFieldValuesSchema>;

export const ListCustomFieldDefsQuerySchema = z.object({
  entityType: CustomFieldEntityTypeSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListCustomFieldDefsQueryDto = z.infer<typeof ListCustomFieldDefsQuerySchema>;
