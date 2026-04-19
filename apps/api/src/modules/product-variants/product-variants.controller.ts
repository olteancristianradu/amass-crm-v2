import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateProductVariantSchema,
  UpdateProductVariantSchema,
} from '@amass/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ProductVariantsService } from './product-variants.service';

const AdjustStockSchema = z.object({ delta: z.coerce.number().int() });

@Controller('product-variants')
@UseGuards(JwtAuthGuard)
export class ProductVariantsController {
  constructor(private readonly variants: ProductVariantsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateProductVariantSchema)) body: Parameters<ProductVariantsService['create']>[0]) {
    return this.variants.create(body);
  }

  @Get()
  findAll(@Query('productId') productId: string) {
    return this.variants.findByProduct(productId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.variants.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductVariantSchema)) body: Parameters<ProductVariantsService['update']>[1],
  ) {
    return this.variants.update(id, body);
  }

  @Post(':id/adjust-stock')
  adjustStock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdjustStockSchema)) body: { delta: number },
  ) {
    return this.variants.adjustStock(id, body.delta);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.variants.remove(id);
  }
}
