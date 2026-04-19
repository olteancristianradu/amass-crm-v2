import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import {
  CreateProductBundleSchema,
  UpdateProductBundleSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ProductBundlesService } from './product-bundles.service';

@Controller('product-bundles')
@UseGuards(JwtAuthGuard)
export class ProductBundlesController {
  constructor(private readonly bundles: ProductBundlesService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateProductBundleSchema)) body: Parameters<ProductBundlesService['create']>[0]) {
    return this.bundles.create(body);
  }

  @Get()
  findAll() {
    return this.bundles.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bundles.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductBundleSchema)) body: Parameters<ProductBundlesService['update']>[1],
  ) {
    return this.bundles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.bundles.remove(id);
  }
}
