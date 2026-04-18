import { z } from 'zod';

const money = z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');
const qty = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, 'must be a positive decimal with up to 3 fraction digits');
const vatRate = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'VAT rate must be non-negative decimal');
const currency = z.enum(['RON', 'EUR', 'USD']);

export const CreateProductCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateProductCategoryDto = z.infer<typeof CreateProductCategorySchema>;
export const UpdateProductCategorySchema = CreateProductCategorySchema.partial();
export type UpdateProductCategoryDto = z.infer<typeof UpdateProductCategorySchema>;

export const CreateProductSchema = z.object({
  categoryId: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  unit: z.string().trim().min(1).max(20).default('buc'),
  defaultPrice: money.default('0'),
  vatRate: vatRate.default('19'),
  currency: currency.default('RON'),
  isActive: z.boolean().default(true),
});
export type CreateProductDto = z.infer<typeof CreateProductSchema>;
export const UpdateProductSchema = CreateProductSchema.partial();
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;

export const CreatePriceListSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  currency: currency.default('RON'),
  isDefault: z.boolean().default(false),
});
export type CreatePriceListDto = z.infer<typeof CreatePriceListSchema>;
export const UpdatePriceListSchema = CreatePriceListSchema.partial();
export type UpdatePriceListDto = z.infer<typeof UpdatePriceListSchema>;

export const UpsertPriceListItemSchema = z.object({
  productId: z.string().min(1).max(64),
  unitPrice: money,
  minQuantity: qty.default('1'),
});
export type UpsertPriceListItemDto = z.infer<typeof UpsertPriceListItemSchema>;

export const ListProductsQuerySchema = z.object({
  categoryId: z.string().max(64).optional(),
  q: z.string().max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProductsQueryDto = z.infer<typeof ListProductsQuerySchema>;
