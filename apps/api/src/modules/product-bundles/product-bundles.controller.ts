import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateProductBundleSchema,
  UpdateProductBundleSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProductBundlesService } from './product-bundles.service';

@Controller('product-bundles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductBundlesController {
  constructor(private readonly bundles: ProductBundlesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(CreateProductBundleSchema)) body: Parameters<ProductBundlesService['create']>[0]) {
    return this.bundles.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll() {
    return this.bundles.findAll();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.bundles.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductBundleSchema)) body: Parameters<ProductBundlesService['update']>[1],
  ) {
    return this.bundles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.bundles.remove(id);
  }
}
