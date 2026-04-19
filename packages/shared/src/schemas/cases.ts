import { z } from 'zod';

/**
 * S56 Cases — internal support tickets linked to a Company/Contact.
 * Tracks SLA deadline, priority, assignee, and resolution.
 */

export const CaseStatusSchema = z.enum(['NEW', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);
export type CaseStatusDto = z.infer<typeof CaseStatusSchema>;

export const CasePrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export type CasePriorityDto = z.infer<typeof CasePrioritySchema>;

export const CreateCaseSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000).optional(),
  priority: CasePrioritySchema.default('NORMAL'),
  companyId: z.string().min(1).max(64).optional(),
  contactId: z.string().min(1).max(64).optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  slaDeadline: z.coerce.date().optional(),
});
export type CreateCaseDto = z.infer<typeof CreateCaseSchema>;

export const UpdateCaseSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    description: z.string().trim().max(8000).nullable(),
    status: CaseStatusSchema,
    priority: CasePrioritySchema,
    companyId: z.string().min(1).max(64).nullable(),
    contactId: z.string().min(1).max(64).nullable(),
    assigneeId: z.string().min(1).max(64).nullable(),
    slaDeadline: z.coerce.date().nullable(),
    resolution: z.string().trim().max(8000).nullable(),
  })
  .partial();
export type UpdateCaseDto = z.infer<typeof UpdateCaseSchema>;

export const ListCasesQuerySchema = z.object({
  status: CaseStatusSchema.optional(),
  priority: CasePrioritySchema.optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  companyId: z.string().min(1).max(64).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCasesQueryDto = z.infer<typeof ListCasesQuerySchema>;
