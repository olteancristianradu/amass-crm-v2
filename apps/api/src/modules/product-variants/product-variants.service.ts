import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductVariant } from '@prisma/client';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class ProductVariantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductVariantDto): Promise<ProductVariant> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productVariant.create({
        data: {
          tenantId: ctx.tenantId,
          productId: dto.productId,
          sku: dto.sku,
          name: dto.name,
          price: dto.price != null ? new Prisma.Decimal(dto.price) : null,
          stockQty: dto.stockQty,
        },
      }),
    );
  }

  async findByProduct(productId: string): Promise<ProductVariant[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productVariant.findMany({
        where: { tenantId: ctx.tenantId, productId },
        orderBy: { sku: 'asc' },
      }),
    );
  }

  async findOne(id: string): Promise<ProductVariant> {
    const ctx = requireTenantContext();
    const v = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productVariant.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!v) throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Product variant not found' });
    return v;
  }

  async update(id: string, dto: UpdateProductVariantDto): Promise<ProductVariant> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.ProductVariantUpdateInput = {
      ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.price !== undefined ? { price: dto.price != null ? new Prisma.Decimal(dto.price) : null } : {}),
      ...(dto.stockQty !== undefined ? { stockQty: dto.stockQty } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productVariant.update({ where: { id }, data }),
    );
  }

  async adjustStock(id: string, delta: number): Promise<ProductVariant> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productVariant.update({
        where: { id },
        data: { stockQty: { increment: delta } },
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.productVariant.delete({ where: { id } }),
    );
  }
}
