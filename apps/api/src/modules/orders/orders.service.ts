import { Injectable, NotFoundException } from '@nestjs/common';
import { Order, OrderItem, Prisma } from '@prisma/client';
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  UpdateOrderDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

type OrderWithItems = Order & { items: OrderItem[] };

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto): Promise<OrderWithItems> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const last = await tx.order.findFirst({
        where: { tenantId: ctx.tenantId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;
      const items = dto.items.map((it) => {
        const total = new Prisma.Decimal(it.quantity).mul(new Prisma.Decimal(it.unitPrice));
        return {
          productId: it.productId ?? null,
          description: it.description,
          quantity: new Prisma.Decimal(it.quantity),
          unitPrice: new Prisma.Decimal(it.unitPrice),
          total,
        };
      });
      const totalAmount = items.reduce(
        (acc, it) => acc.add(it.total),
        new Prisma.Decimal(0),
      );
      return tx.order.create({
        data: {
          tenantId: ctx.tenantId,
          number,
          companyId: dto.companyId,
          quoteId: dto.quoteId ?? null,
          currency: dto.currency,
          notes: dto.notes ?? null,
          totalAmount,
          createdById: ctx.userId ?? null,
          items: { create: items },
        },
        include: { items: true },
      });
    });
  }

  async findAll(q: ListOrdersQueryDto): Promise<CursorPage<Order>> {
    const ctx = requireTenantContext();
    const where: Prisma.OrderWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.order.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<OrderWithItems> {
    const ctx = requireTenantContext();
    const order = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.order.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: { items: true },
      }),
    );
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    return order;
  }

  async update(id: string, dto: UpdateOrderDto): Promise<Order> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    const stamp: Partial<Prisma.OrderUpdateInput> = {};
    if (dto.status === 'CONFIRMED' && existing.status === 'DRAFT') stamp.confirmedAt = new Date();
    if (dto.status === 'FULFILLED' && existing.status !== 'FULFILLED') stamp.fulfilledAt = new Date();
    if (dto.status === 'CANCELLED' && existing.status !== 'CANCELLED') stamp.cancelledAt = new Date();
    const data: Prisma.OrderUpdateInput = {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...stamp,
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.order.update({ where: { id }, data }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.order.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}
