import { z } from 'zod';

export const CreateProductVariantSchema = z.object({
  productId: z.string().min(1).max(64),
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  price: z.coerce.number().nonnegative().optional(),
  stockQty: z.coerce.number().int().nonnegative().default(0),
});
export type CreateProductVariantDto = z.infer<typeof CreateProductVariantSchema>;

export const UpdateProductVariantSchema = CreateProductVariantSchema.partial();
export type UpdateProductVariantDto = z.infer<typeof UpdateProductVariantSchema>;

export const BundleItemSchema = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.coerce.number().int().positive().default(1),
});
export type BundleItemDto = z.infer<typeof BundleItemSchema>;

export const CreateProductBundleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  price: z.coerce.number().nonnegative(),
  currency: z.string().trim().min(3).max(3).default('RON'),
  isActive: z.boolean().default(true),
  items: z.array(BundleItemSchema).default([]),
});
export type CreateProductBundleDto = z.infer<typeof CreateProductBundleSchema>;

export const UpdateProductBundleSchema = CreateProductBundleSchema.partial();
export type UpdateProductBundleDto = z.infer<typeof UpdateProductBundleSchema>;
