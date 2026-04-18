import { z } from 'zod';

export const ReportEntityTypeSchema = z.enum([
  'DEAL', 'COMPANY', 'CONTACT', 'CLIENT', 'INVOICE', 'QUOTE', 'CALL', 'ACTIVITY',
]);
export type ReportEntityType = z.infer<typeof ReportEntityTypeSchema>;

export const ReportFilterSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'in', 'isNull', 'isNotNull']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});
export type ReportFilter = z.infer<typeof ReportFilterSchema>;

export const ReportConfigSchema = z.object({
  columns: z.array(z.string().min(1).max(64)).min(1).max(20),
  filters: z.array(ReportFilterSchema).max(20).default([]),
  groupBy: z.string().max(64).optional(),
  orderBy: z.string().max(64).optional(),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
  chartType: z.enum(['table', 'bar', 'line', 'pie']).default('table'),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type ReportConfig = z.infer<typeof ReportConfigSchema>;

export const CreateReportTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  entityType: ReportEntityTypeSchema,
  config: ReportConfigSchema,
  isShared: z.boolean().default(false),
});
export type CreateReportTemplateDto = z.infer<typeof CreateReportTemplateSchema>;

export const UpdateReportTemplateSchema = CreateReportTemplateSchema.partial();
export type UpdateReportTemplateDto = z.infer<typeof UpdateReportTemplateSchema>;
