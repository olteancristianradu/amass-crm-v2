import { z } from 'zod';
import { LeadSourceSchema } from './company';

/**
 * S53 Leads — top-of-funnel records that haven't yet been converted to
 * a Contact/Company/Deal. A lead can be converted in one atomic operation
 * which stamps convertedAt and the IDs of the created records.
 */

export { LeadSourceSchema };
export type LeadSourceDto = z.infer<typeof LeadSourceSchema>;

export const LeadStatusSchema = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
]);
export type LeadStatusDto = z.infer<typeof LeadStatusSchema>;

export const CreateLeadSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().max(100).optional(),
  source: LeadSourceSchema.optional(),
  status: LeadStatusSchema.optional(),
  score: z.number().int().min(0).max(100).optional(),
  ownerId: z.string().min(1).max(64).optional(),
  notes: z.string().trim().max(4000).optional(),
});
export type CreateLeadDto = z.infer<typeof CreateLeadSchema>;

export const UpdateLeadSchema = z
  .object({
    firstName: z.string().trim().max(100).nullable(),
    lastName: z.string().trim().max(100).nullable(),
    email: z.string().trim().email().max(254).nullable(),
    phone: z.string().trim().max(50).nullable(),
    company: z.string().trim().max(200).nullable(),
    jobTitle: z.string().trim().max(100).nullable(),
    source: LeadSourceSchema.nullable(),
    status: LeadStatusSchema,
    score: z.number().int().min(0).max(100),
    ownerId: z.string().min(1).max(64).nullable(),
    notes: z.string().trim().max(4000).nullable(),
  })
  .partial();
export type UpdateLeadDto = z.infer<typeof UpdateLeadSchema>;

/**
 * ConvertLeadDto — the body for POST /leads/:id/convert.
 *
 * The conversion process:
 *   1. Creates a Contact from the lead's name/email/phone/jobTitle.
 *   2. Optionally creates (or links) a Company using companyName or existingCompanyId.
 *   3. Optionally creates a Deal linked to the new contact/company.
 *   4. Stamps lead.convertedAt, lead.status = CONVERTED and stores the
 *      created IDs for traceability.
 */
export const ConvertLeadSchema = z.object({
  // Company — either create a new one or link to an existing one
  createCompany: z.boolean().default(false),
  companyName: z.string().trim().min(1).max(200).optional(),
  existingCompanyId: z.string().min(1).max(64).optional(),
  // Deal — create an optional deal linked to the conversion
  createDeal: z.boolean().default(false),
  dealTitle: z.string().trim().min(1).max(200).optional(),
  dealPipelineId: z.string().min(1).max(64).optional(),
  dealStageId: z.string().min(1).max(64).optional(),
  dealValue: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,2})?$/, 'value must be a decimal with up to 2 fraction digits')
    .optional(),
});
export type ConvertLeadDto = z.infer<typeof ConvertLeadSchema>;

export const ListLeadsQuerySchema = z.object({
  status: LeadStatusSchema.optional(),
  source: LeadSourceSchema.optional(),
  ownerId: z.string().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListLeadsQueryDto = z.infer<typeof ListLeadsQuerySchema>;
