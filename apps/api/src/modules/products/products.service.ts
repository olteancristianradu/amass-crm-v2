import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateProductCategoryDto,
  CreateProductDto,
  CreatePriceListDto,
  ListProductsQueryDto,
  UpdateProductCategoryDto,
  UpdateProductDto,
  UpdatePriceListDto,
  UpsertPriceListItemDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Categories ────────────────────────────────────────────────────────────

  async createCategory(dto: CreateProductCategoryDto) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.productCategory.create({ data: { tenantId, name: dto.name } }),
    );
  }

  async listCategories() {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.productCategory.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async updateCategory(id: string, dto: UpdateProductCategoryDto) {
    const { tenantId } = requireTenantContext();
    await this.assertCategory(tenantId, id);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.productCategory.update({ where: { id }, data: dto }),
    );
  }

  async removeCategory(id: string) {
    const { tenantId } = requireTenantContext();
    await this.assertCategory(tenantId, id);
    // reassign products before deleting category
    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.product.updateMany({ where: { categoryId: id, tenantId }, data: { categoryId: null } });
      await tx.productCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  private async assertCategory(tenantId: string, id: string) {
    const cat = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.productCategory.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  // ─── Products ──────────────────────────────────────────────────────────────

  async create(dto: CreateProductDto) {
    const { tenantId } = requireTenantContext();
    if (dto.sku) {
      const existing = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.product.findFirst({ where: { tenantId, sku: dto.sku, deletedAt: null } }),
      );
      if (existing) throw new ConflictException({ code: 'PRODUCT_SKU_CONFLICT', message: 'SKU already exists' });
    }
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.product.create({
        data: {
          tenantId,
          categoryId: dto.categoryId ?? null,
          name: dto.name,
          sku: dto.sku ?? null,
          description: dto.description ?? null,
          unit: dto.unit,
          defaultPrice: new Prisma.Decimal(dto.defaultPrice),
          vatRate: new Prisma.Decimal(dto.vatRate),
          currency: dto.currency as never,
          isActive: dto.isActive,
        },
        include: { category: true },
      }),
    );
  }

  async list(query: ListProductsQueryDto): Promise<CursorPage<unknown>> {
    const { tenantId } = requireTenantContext();
    const where: Prisma.ProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const items = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.product.findMany({
        where,
        include: { category: true },
        ...buildCursorArgs(query.cursor, query.limit),
        orderBy: { name: 'asc' },
      }),
    );
    return makeCursorPage(items, query.limit);
  }

  async findOne(id: string) {
    const { tenantId } = requireTenantContext();
    const p = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.product.findFirst({ where: { id, tenantId, deletedAt: null }, include: { category: true } }),
    );
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.product.update({
        where: { id },
        data: {
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId ?? null } : {}),
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.sku !== undefined ? { sku: dto.sku ?? null } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.unit ? { unit: dto.unit } : {}),
          ...(dto.defaultPrice ? { defaultPrice: new Prisma.Decimal(dto.defaultPrice) } : {}),
          ...(dto.vatRate ? { vatRate: new Prisma.Decimal(dto.vatRate) } : {}),
          ...(dto.currency ? { currency: dto.currency as never } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: { category: true },
      }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.product.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  // ─── Price Lists ───────────────────────────────────────────────────────────

  async createPriceList(dto: CreatePriceListDto) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      if (dto.isDefault) {
        await tx.priceList.updateMany({ where: { tenantId, deletedAt: null }, data: { isDefault: false } });
      }
      return tx.priceList.create({
        data: { tenantId, name: dto.name, description: dto.description ?? null, currency: dto.currency as never, isDefault: dto.isDefault },
      });
    });
  }

  async listPriceLists() {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.priceList.findMany({
        where: { tenantId, deletedAt: null },
        include: { items: { include: { product: true } } },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  async updatePriceList(id: string, dto: UpdatePriceListDto) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      if (dto.isDefault) {
        await tx.priceList.updateMany({ where: { tenantId, deletedAt: null, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.priceList.update({ where: { id }, data: { ...dto, currency: dto.currency as never } });
    });
  }

  async upsertPriceListItem(priceListId: string, dto: UpsertPriceListItemDto) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.priceListItem.upsert({
        where: { priceListId_productId_minQuantity: { priceListId, productId: dto.productId, minQuantity: new Prisma.Decimal(dto.minQuantity) } },
        create: {
          tenantId,
          priceListId,
          productId: dto.productId,
          unitPrice: new Prisma.Decimal(dto.unitPrice),
          minQuantity: new Prisma.Decimal(dto.minQuantity),
        },
        update: { unitPrice: new Prisma.Decimal(dto.unitPrice) },
      }),
    );
  }

  async removePriceListItem(priceListId: string, productId: string, minQuantity: string) {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.priceListItem.deleteMany({ where: { priceListId, productId, tenantId, minQuantity: new Prisma.Decimal(minQuantity) } }),
    );
  }

  /** Resolve unit price for a product from the given price list (highest minQty <= requested qty). */
  async resolvePrice(productId: string, quantity: string, priceListId?: string): Promise<string> {
    const { tenantId } = requireTenantContext();
    const qty = new Prisma.Decimal(quantity);
    if (priceListId) {
      const item = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.priceListItem.findFirst({
          where: { priceListId, productId, tenantId, minQuantity: { lte: qty } },
          orderBy: { minQuantity: 'desc' },
        }),
      );
      if (item) return item.unitPrice.toString();
    }
    const product = await this.findOne(productId);
    return product.defaultPrice.toString();
  }
}
