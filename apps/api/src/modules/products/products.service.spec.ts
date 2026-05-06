import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

type Mock = ReturnType<typeof vi.fn>;

interface MockTx {
  product: { create: Mock; findFirst: Mock; update: Mock; updateMany: Mock; findMany: Mock };
  productCategory: { create: Mock; findMany: Mock; findFirst: Mock; update: Mock };
}

describe('ProductsService', () => {
  let svc: ProductsService;
  let tx: MockTx;
  let runWithTenant: Mock;

  beforeEach(() => {
    tx = {
      product: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        findMany: vi.fn(),
      },
      productCategory: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };
    runWithTenant = vi.fn(async (_tid: string, fn: (t: MockTx) => unknown) => fn(tx));
    const prisma = { runWithTenant } as unknown as ConstructorParameters<typeof ProductsService>[0];
    svc = new ProductsService(prisma);
  });

  describe('categories', () => {
    it('creates a category with tenantId', async () => {
      tx.productCategory.create.mockResolvedValue({ id: 'c-1' });
      await svc.createCategory({ name: 'Software' } as never);
      expect(tx.productCategory.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', name: 'Software' },
      });
    });

    it('lists only non-deleted categories', async () => {
      tx.productCategory.findMany.mockResolvedValue([]);
      await svc.listCategories();
      expect(tx.productCategory.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', deletedAt: null },
        orderBy: { name: 'asc' },
      });
    });

    it('throws NotFound when updating a missing category', async () => {
      tx.productCategory.findFirst.mockResolvedValue(null);
      await expect(svc.updateCategory('ghost', { name: 'X' } as never)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reassigns products to null then soft-deletes the category', async () => {
      tx.productCategory.findFirst.mockResolvedValue({ id: 'c-1' });
      await svc.removeCategory('c-1');
      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'c-1', tenantId: 'tenant-1' },
        data: { categoryId: null },
      });
      expect(tx.productCategory.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe('products', () => {
    it('rejects duplicate SKU on create', async () => {
      tx.product.findFirst.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        svc.create({ name: 'X', sku: 'SKU-1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.product.create).not.toHaveBeenCalled();
    });

    it('allows create when SKU does not exist', async () => {
      tx.product.findFirst.mockResolvedValueOnce(null);
      tx.product.create.mockResolvedValue({ id: 'p-1' });
      await svc.create({
        name: 'X', sku: 'SKU-2', unit: 'BUC',
        defaultPrice: '100', vatRate: '19', currency: 'RON', isActive: true,
      } as never);
      expect(tx.product.create).toHaveBeenCalled();
    });

    it('skips SKU conflict check when SKU is omitted', async () => {
      tx.product.create.mockResolvedValue({ id: 'p-1' });
      await svc.create({
        name: 'No-SKU', unit: 'BUC',
        defaultPrice: '100', vatRate: '19', currency: 'RON', isActive: true,
      } as never);
      expect(tx.product.findFirst).not.toHaveBeenCalled();
    });
  });
});
