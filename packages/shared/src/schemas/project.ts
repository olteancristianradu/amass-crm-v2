import { z } from 'zod';
import { InvoiceCurrencySchema } from './invoice';

/**
 * S23 Projects — created from a won Deal, groups invoices/tasks/attachments
 * under one delivery umbrella.
 */
export const ProjectStatusSchema = z.enum([
  'PLANNED',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
]);
export type ProjectStatusDto = z.infer<typeof ProjectStatusSchema>;

const money = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

export const CreateProjectSchema = z.object({
  companyId: z.string().min(1).max(64),
  dealId: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  status: ProjectStatusSchema.default('PLANNED'),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  budget: money.optional(),
  currency: InvoiceCurrencySchema.default('RON'),
});
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    status: ProjectStatusSchema,
    startDate: z.coerce.date().nullable(),
    endDate: z.coerce.date().nullable(),
    budget: money.nullable(),
    currency: InvoiceCurrencySchema,
  })
  .partial();
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

export const ListProjectsQuerySchema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  status: ProjectStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProjectsQueryDto = z.infer<typeof ListProjectsQuerySchema>;
