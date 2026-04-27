import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateProductCategorySchema, CreateProductCategoryDto,
  CreateProductSchema, CreateProductDto,
  UpdateProductCategorySchema, UpdateProductCategoryDto,
  UpdateProductSchema, UpdateProductDto,
  CreatePriceListSchema, CreatePriceListDto,
  UpdatePriceListSchema, UpdatePriceListDto,
  UpsertPriceListItemSchema, UpsertPriceListItemDto,
  ListProductsQuerySchema, ListProductsQueryDto,
} from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  // ─── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listCategories() { return this.svc.listCategories(); }

  @Post('categories')
  @RequireCedar({ action: 'product-category::create', resource: 'ProductCategory::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  createCategory(@Body(new ZodValidationPipe(CreateProductCategorySchema)) dto: CreateProductCategoryDto) {
    return this.svc.createCategory(dto);
  }

  @Patch('categories/:id')
  @RequireCedar({
    action: 'product-category::update',
    resource: (req) => `ProductCategory::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductCategorySchema)) dto: UpdateProductCategoryDto,
  ) { return this.svc.updateCategory(id, dto); }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequireCedar({
    action: 'product-category::delete',
    resource: (req) => `ProductCategory::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  removeCategory(@Param('id') id: string) { return this.svc.removeCategory(id); }

  // ─── Products ──────────────────────────────────────────────────────────────

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListProductsQuerySchema)) q: ListProductsQueryDto) {
    return this.svc.list(q);
  }

  @Post()
  @RequireCedar({ action: 'product::create', resource: 'Product::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body(new ZodValidationPipe(CreateProductSchema)) dto: CreateProductDto) {
    return this.svc.create(dto);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Patch(':id')
  @RequireCedar({
    action: 'product::update',
    resource: (req) => `Product::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateProductSchema)) dto: UpdateProductDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'product::delete',
    resource: (req) => `Product::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  // ─── Price Lists ───────────────────────────────────────────────────────────

  @Get('price-lists')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listPriceLists() { return this.svc.listPriceLists(); }

  @Post('price-lists')
  @RequireCedar({ action: 'price-list::create', resource: 'PriceList::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  createPriceList(@Body(new ZodValidationPipe(CreatePriceListSchema)) dto: CreatePriceListDto) {
    return this.svc.createPriceList(dto);
  }

  @Patch('price-lists/:id')
  @RequireCedar({
    action: 'price-list::update',
    resource: (req) => `PriceList::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  updatePriceList(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePriceListSchema)) dto: UpdatePriceListDto,
  ) { return this.svc.updatePriceList(id, dto); }

  @Post('price-lists/:id/items')
  @HttpCode(200)
  @RequireCedar({
    action: 'price-list-item::update',
    resource: (req) => `PriceList::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  upsertItem(
    @Param('id') priceListId: string,
    @Body(new ZodValidationPipe(UpsertPriceListItemSchema)) dto: UpsertPriceListItemDto,
  ) { return this.svc.upsertPriceListItem(priceListId, dto); }

  @Delete('price-lists/:id/items/:productId')
  @HttpCode(204)
  @RequireCedar({
    action: 'price-list-item::delete',
    resource: (req) => `PriceList::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  removeItem(
    @Param('id') priceListId: string,
    @Param('productId') productId: string,
    @Query('minQuantity') minQuantity = '1',
  ) { return this.svc.removePriceListItem(priceListId, productId, minQuantity); }
}
