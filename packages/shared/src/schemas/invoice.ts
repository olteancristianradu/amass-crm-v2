import { z } from 'zod';

/**
 * S22 Invoices — emitted by the tenant to a Company (customer).
 *
 * Monetary values travel as decimal strings (like Deal.value) to avoid
 * floating-point drift. All `amount` fields accept max 2 decimals except
 * `quantity` which allows 3 (common in services: "0.25 hours").
 *
 * Totals are computed server-side from lines — client submits only per-line
 * values and the service derives invoice subtotal/vat/total.
 */
export const InvoiceStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);
export type InvoiceStatusDto = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceCurrencySchema = z.enum(['RON', 'EUR', 'USD']);
export type InvoiceCurrencyDto = z.infer<typeof InvoiceCurrencySchema>;

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

export const InvoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity,
  unitPrice: money,
  vatRate: vatRate.default('19'),
});
export type InvoiceLineInputDto = z.infer<typeof InvoiceLineInputSchema>;

export const CreateInvoiceSchema = z.object({
  companyId: z.string().min(1).max(64),
  dealId: z.string().min(1).max(64).optional(),
  series: z.string().trim().min(1).max(16).default('AMS'),
  number: z.number().int().positive().optional(),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  currency: InvoiceCurrencySchema.default('RON'),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(InvoiceLineInputSchema).min(1).max(200),
});
export type CreateInvoiceDto = z.infer<typeof CreateInvoiceSchema>;

/**
 * Patch payload. Lines can be swapped entirely (full replacement) or left
 * absent to keep existing. Status changes go through the dedicated
 * /invoices/:id/status endpoint (DRAFT→ISSUED etc.) so the service can
 * enforce the transition rules and trigger PDF generation.
 */
export const UpdateInvoiceSchema = z
  .object({
    issueDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    currency: InvoiceCurrencySchema,
    notes: z.string().trim().max(2000).nullable(),
    lines: z.array(InvoiceLineInputSchema).min(1).max(200),
  })
  .partial();
export type UpdateInvoiceDto = z.infer<typeof UpdateInvoiceSchema>;

export const ChangeInvoiceStatusSchema = z.object({
  status: InvoiceStatusSchema,
});
export type ChangeInvoiceStatusDto = z.infer<typeof ChangeInvoiceStatusSchema>;

export const ListInvoicesQuerySchema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  dealId: z.string().min(1).max(64).optional(),
  status: InvoiceStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListInvoicesQueryDto = z.infer<typeof ListInvoicesQuerySchema>;

// ── Payments (S24) ──────────────────────────────────────────────────────────

export const PaymentMethodSchema = z.enum(['BANK', 'CASH', 'CARD', 'OTHER']);
export type PaymentMethodDto = z.infer<typeof PaymentMethodSchema>;

export const CreatePaymentSchema = z.object({
  amount: money,
  paidAt: z.coerce.date(),
  method: PaymentMethodSchema.default('BANK'),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreatePaymentDto = z.infer<typeof CreatePaymentSchema>;
