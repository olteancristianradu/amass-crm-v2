import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('OrdersService', () => {
  let svc: OrdersService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrdersService(mockPrisma);
  });

  it('create() assigns next number per tenant (first order = 1)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockImplementation(async ({ data }) => ({ id: 'o-1', ...data, items: [] }));
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ order: { findFirst, create } }));

    const out = await svc.create({
      companyId: 'co-1',
      currency: 'RON',
      items: [{ description: 'widget', quantity: 2, unitPrice: 10 }],
    } as any);

    expect((out as any).number).toBe(1);
  });

  it('create() computes per-line total and aggregates totalAmount', async () => {
    const findFirst = vi.fn().mockResolvedValue({ number: 7 });
    const create = vi.fn().mockImplementation(async ({ data }) => ({ id: 'o-8', ...data, items: [] }));
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ order: { findFirst, create } }));

    await svc.create({
      companyId: 'co-1',
      currency: 'RON',
      items: [
        { description: 'a', quantity: 2, unitPrice: 10 }, // 20
        { description: 'b', quantity: 1, unitPrice: 5.5 }, // 5.5
      ],
    } as any);

    const data = create.mock.calls[0][0].data;
    expect(data.number).toBe(8);
    expect(Number(data.totalAmount)).toBe(25.5);
    const items = data.items.create as Array<{ total: Prisma.Decimal }>;
    expect(Number(items[0].total)).toBe(20);
    expect(Number(items[1].total)).toBe(5.5);
  });

  it('update() stamps confirmedAt only on DRAFT → CONFIRMED', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'o-1', status: 'DRAFT', items: [] })
      .mockResolvedValueOnce({ id: 'o-2', status: 'CONFIRMED', items: [] });
    const update = vi.fn().mockResolvedValue({});
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ order: { findFirst, update } }),
    );

    await svc.update('o-1', { status: 'CONFIRMED' } as any);
    expect(update.mock.calls[0][0].data.confirmedAt).toBeInstanceOf(Date);

    await svc.update('o-2', { status: 'CONFIRMED' } as any);
    expect(update.mock.calls[1][0].data.confirmedAt).toBeUndefined();
  });

  it('update() stamps fulfilledAt / cancelledAt when transitioning', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'o-3', status: 'CONFIRMED', items: [] })
      .mockResolvedValueOnce({ id: 'o-4', status: 'CONFIRMED', items: [] });
    const update = vi.fn().mockResolvedValue({});
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ order: { findFirst, update } }),
    );

    await svc.update('o-3', { status: 'FULFILLED' } as any);
    expect(update.mock.calls[0][0].data.fulfilledAt).toBeInstanceOf(Date);

    await svc.update('o-4', { status: 'CANCELLED' } as any);
    expect(update.mock.calls[1][0].data.cancelledAt).toBeInstanceOf(Date);
  });

  it('findOne() throws NotFoundException when missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ order: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.findOne('x')).rejects.toThrow(NotFoundException);
  });
});
