import { z } from 'zod';

/**
 * S54 Contracts — legal agreements between the tenant and a Company.
 * The document itself is stored in MinIO; the DB holds only `storageKey`
 * plus structured metadata (dates, value, status).
 */

export const ContractStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
  'RENEWED',
]);
export type ContractStatusDto = z.infer<typeof ContractStatusSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'value must be a decimal with up to 2 fraction digits');

export const CreateContractSchema = z.object({
  companyId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  value: decimalString.optional(),
  currency: z.string().trim().length(3).toUpperCase().default('RON'),
  status: ContractStatusSchema.optional(),
  signedAt: z.coerce.date().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  renewalDate: z.coerce.date().optional(),
  autoRenew: z.boolean().default(false),
  storageKey: z.string().trim().max(500).optional(),
});
export type CreateContractDto = z.infer<typeof CreateContractSchema>;

export const UpdateContractSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    value: decimalString.nullable(),
    currency: z.string().trim().length(3).toUpperCase(),
    status: ContractStatusSchema,
    signedAt: z.coerce.date().nullable(),
    startDate: z.coerce.date().nullable(),
    endDate: z.coerce.date().nullable(),
    renewalDate: z.coerce.date().nullable(),
    autoRenew: z.boolean(),
    storageKey: z.string().trim().max(500).nullable(),
  })
  .partial();
export type UpdateContractDto = z.infer<typeof UpdateContractSchema>;

export const ListContractsQuerySchema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  status: ContractStatusSchema.optional(),
  expiringInDays: z.coerce.number().int().min(1).max(365).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListContractsQueryDto = z.infer<typeof ListContractsQuerySchema>;
