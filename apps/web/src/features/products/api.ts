import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku?: string | null;
  unitPrice: string;
  vatRate: string;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductDto {
  name: string;
  sku?: string;
  unitPrice: string;
  vatRate: string;
  categoryId?: string;
}

export const productsApi = {
  list: (cursor?: string, limit = 50) =>
    api.get<CursorPage<Product>>('/products', { cursor, limit }),
  get: (id: string) => api.get<Product>(`/products/${id}`),
  create: (dto: CreateProductDto) => api.post<Product>('/products', dto),
  update: (id: string, dto: Partial<CreateProductDto>) =>
    api.patch<Product>(`/products/${id}`, dto),
  /** Soft-delete (archive) a product. */
  archive: (id: string) => api.delete<void>(`/products/${id}`),
};
