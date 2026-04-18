import { z } from 'zod';

export const QuoteStatusSchema = z.enum(['DRAFT', 'PENDING_APPROVAL', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

const money = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');
const quantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'must be a positive decimal with up to 3 fraction digits');
const vatRate = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'VAT rate must be a non-negative decimal');

export const QuoteLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity,
  unitPrice: money,
  vatRate: vatRate.default('19'),
});
export type QuoteLineInputDto = z.infer<typeof QuoteLineInputSchema>;

export const CreateQuoteSchema = z.object({
  companyId: z.string().min(1).max(64),
  dealId: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(256),
  issueDate: z.coerce.date(),
  validUntil: z.coerce.date(),
  currency: z.enum(['RON', 'EUR', 'USD']).default('RON'),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(QuoteLineInputSchema).min(1).max(200),
});
export type CreateQuoteDto = z.infer<typeof CreateQuoteSchema>;

export const UpdateQuoteSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    issueDate: z.coerce.date(),
    validUntil: z.coerce.date(),
    currency: z.enum(['RON', 'EUR', 'USD']),
    notes: z.string().trim().max(2000).nullable(),
    lines: z.array(QuoteLineInputSchema).min(1).max(200),
  })
  .partial();
export type UpdateQuoteDto = z.infer<typeof UpdateQuoteSchema>;

export const ChangeQuoteStatusSchema = z.object({
  status: QuoteStatusSchema,
});
export type ChangeQuoteStatusDto = z.infer<typeof ChangeQuoteStatusSchema>;

export const ListQuotesQuerySchema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  dealId: z.string().min(1).max(64).optional(),
  status: QuoteStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuotesQueryDto = z.infer<typeof ListQuotesQuerySchema>;

export const ConvertQuoteToInvoiceSchema = z.object({
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  series: z.string().trim().min(1).max(16).default('AMS'),
});
export type ConvertQuoteToInvoiceDto = z.infer<typeof ConvertQuoteToInvoiceSchema>;
