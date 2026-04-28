import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateProductVariantSchema,
  UpdateProductVariantSchema,
} from '@amass/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ProductVariantsService } from './product-variants.service';

const AdjustStockSchema = z.object({ delta: z.coerce.number().int() });

@Controller('product-variants')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ProductVariantsController {
  constructor(private readonly variants: ProductVariantsService) {}

  @Post()
  @RequireCedar({ action: 'product-variant::create', resource: 'ProductVariant::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body(new ZodValidationPipe(CreateProductVariantSchema)) body: Parameters<ProductVariantsService['create']>[0]) {
    return this.variants.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query('productId') productId: string) {
    return this.variants.findByProduct(productId);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.variants.findOne(id);
  }

  @Patch(':id')
  @RequireCedar({
    action: 'product-variant::update',
    resource: (req) => `ProductVariant::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductVariantSchema)) body: Parameters<ProductVariantsService['update']>[1],
  ) {
    return this.variants.update(id, body);
  }

  @Post(':id/adjust-stock')
  @RequireCedar({
    action: 'product-variant::update',
    resource: (req) => `ProductVariant::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  adjustStock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdjustStockSchema)) body: { delta: number },
  ) {
    return this.variants.adjustStock(id, body.delta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'product-variant::delete',
    resource: (req) => `ProductVariant::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.variants.remove(id);
  }
}
