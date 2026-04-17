import { z } from 'zod';

export const FilterOperatorSchema = z.enum([
  'eq', 'neq', 'contains', 'not_contains', 'starts_with',
  'is_empty', 'is_not_empty', 'gt', 'lt', 'gte', 'lte',
  'is_true', 'is_false',
]);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export const FilterRuleSchema = z.object({
  field: z.string().min(1).max(64),
  operator: FilterOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type FilterRule = z.infer<typeof FilterRuleSchema>;

export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    op: z.enum(['AND', 'OR']),
    rules: z.array(z.union([FilterRuleSchema, FilterGroupSchema])).min(1).max(20),
  }),
);
export interface FilterGroup {
  op: 'AND' | 'OR';
  rules: (FilterRule | FilterGroup)[];
}

export const CreateContactSegmentSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(500).optional(),
  filterJson: FilterGroupSchema,
});
export type CreateContactSegmentDto = z.infer<typeof CreateContactSegmentSchema>;

export const UpdateContactSegmentSchema = CreateContactSegmentSchema.partial();
export type UpdateContactSegmentDto = z.infer<typeof UpdateContactSegmentSchema>;
