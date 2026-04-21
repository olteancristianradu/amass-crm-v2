import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductVariantsService } from './product-variants.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('ProductVariantsService', () => {
  let svc: ProductVariantsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ProductVariantsService(mockPrisma);
  });

  it('create() wraps price in Prisma.Decimal and stamps tenantId', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'v-1' });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ productVariant: { create } }));

    await svc.create({ productId: 'p-1', sku: 'SKU', name: 'v', price: 19.99, stockQty: 5 } as any);

    const arg = create.mock.calls[0][0].data;
    expect(arg.tenantId).toBe('tenant-1');
    expect(arg.productId).toBe('p-1');
    expect(arg.price).toBeInstanceOf(Prisma.Decimal);
    expect(Number(arg.price)).toBe(19.99);
  });

  it('create() keeps price null when not provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'v-2' });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ productVariant: { create } }));
    await svc.create({ productId: 'p-1', sku: 'S', name: 'n', price: null, stockQty: 0 } as any);
    expect(create.mock.calls[0][0].data.price).toBeNull();
  });

  it('findOne() throws NotFoundException when missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ productVariant: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('adjustStock() uses increment delta', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'v-3', stockQty: 10 });
    const findFirst = vi.fn().mockResolvedValue({ id: 'v-3' });
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ productVariant: { findFirst, update } }),
    );
    await svc.adjustStock('v-3', -2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v-3' },
      data: { stockQty: { increment: -2 } },
    });
  });
});
