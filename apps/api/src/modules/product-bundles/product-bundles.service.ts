import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductBundle, ProductBundleItem } from '@prisma/client';
import {
  CreateProductBundleDto,
  UpdateProductBundleDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class ProductBundlesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductBundleDto): Promise<ProductBundle & { items: ProductBundleItem[] }> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productBundle.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          price: new Prisma.Decimal(dto.price),
          currency: dto.currency,
          isActive: dto.isActive,
          items: { create: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
        },
        include: { items: true },
      }),
    );
  }

  async findAll(): Promise<(ProductBundle & { items: ProductBundleItem[] })[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productBundle.findMany({
        where: { tenantId: ctx.tenantId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async findOne(id: string): Promise<ProductBundle & { items: ProductBundleItem[] }> {
    const ctx = requireTenantContext();
    const b = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productBundle.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: { items: true },
      }),
    );
    if (!b) throw new NotFoundException({ code: 'BUNDLE_NOT_FOUND', message: 'Product bundle not found' });
    return b;
  }

  async update(id: string, dto: UpdateProductBundleDto): Promise<ProductBundle & { items: ProductBundleItem[] }> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.ProductBundleUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      if (dto.items !== undefined) {
        // Replace items atomically: simplest correct semantics for small bundles.
        await tx.productBundleItem.deleteMany({ where: { bundleId: id } });
        await tx.productBundleItem.createMany({
          data: dto.items.map((i) => ({ bundleId: id, productId: i.productId, quantity: i.quantity })),
        });
      }
      return tx.productBundle.update({ where: { id }, data, include: { items: true } });
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productBundle.delete({ where: { id } }),
    );
  }
}
