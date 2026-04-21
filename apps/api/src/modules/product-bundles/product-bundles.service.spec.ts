import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductBundlesService } from './product-bundles.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('ProductBundlesService', () => {
  let svc: ProductBundlesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ProductBundlesService(mockPrisma);
  });

  it('create() nests items + wraps price in Prisma.Decimal', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'b-1', items: [] });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ productBundle: { create } }));

    await svc.create({
      name: 'Starter pack',
      description: 'desc',
      price: 99.5,
      currency: 'RON',
      isActive: true,
      items: [
        { productId: 'p-1', quantity: 2 },
        { productId: 'p-2', quantity: 1 },
      ],
    } as any);

    const arg = create.mock.calls[0][0];
    expect(arg.data.tenantId).toBe('tenant-1');
    expect(arg.data.price).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.items.create).toHaveLength(2);
    expect(arg.data.items.create[0]).toEqual({ productId: 'p-1', quantity: 2 });
    expect(arg.include).toEqual({ items: true });
  });

  it('findOne() throws NotFoundException when missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ productBundle: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('update() replaces items atomically via deleteMany+createMany', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'b-2', items: [] });
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ id: 'b-2', items: [] });
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({
        productBundle: { findFirst, update },
        productBundleItem: { deleteMany, createMany },
      }),
    );

    await svc.update('b-2', { items: [{ productId: 'p-9', quantity: 3 }] } as any);

    expect(deleteMany).toHaveBeenCalledWith({ where: { bundleId: 'b-2' } });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ bundleId: 'b-2', productId: 'p-9', quantity: 3 }],
    });
    expect(update).toHaveBeenCalled();
  });

  it('update() leaves items untouched when dto.items is undefined', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'b-3', items: [] });
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const update = vi.fn().mockResolvedValue({ id: 'b-3', items: [] });
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({
        productBundle: { findFirst, update },
        productBundleItem: { deleteMany, createMany },
      }),
    );

    await svc.update('b-3', { name: 'renamed' } as any);

    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
