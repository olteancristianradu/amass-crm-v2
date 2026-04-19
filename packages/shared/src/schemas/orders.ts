import { z } from 'zod';

/**
 * S57 Orders — fulfillment tracking after a Quote is accepted.
 * Each order belongs to a Company and may reference a source Quote.
 */

export const OrderStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']);
export type OrderStatusDto = z.infer<typeof OrderStatusSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be decimal with up to 2 fraction digits');

export const OrderItemInputSchema = z.object({
  productId: z.string().min(1).max(64).optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().nonnegative().default(0),
});
export type OrderItemInputDto = z.infer<typeof OrderItemInputSchema>;

export const CreateOrderSchema = z.object({
  companyId: z.string().min(1).max(64),
  quoteId: z.string().min(1).max(64).optional(),
  currency: z.string().trim().length(3).toUpperCase().default('RON'),
  notes: z.string().trim().max(4000).optional(),
  items: z.array(OrderItemInputSchema).min(1).max(200),
});
export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;

export const UpdateOrderSchema = z
  .object({
    status: OrderStatusSchema,
    notes: z.string().trim().max(4000).nullable(),
  })
  .partial();
export type UpdateOrderDto = z.infer<typeof UpdateOrderSchema>;

export const ListOrdersQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
  companyId: z.string().min(1).max(64).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListOrdersQueryDto = z.infer<typeof ListOrdersQuerySchema>;

export { decimalString as orderDecimalString };
