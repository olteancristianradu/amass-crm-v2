import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductBundlesController } from './product-bundles.controller';
import { ProductBundlesService } from './product-bundles.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductBundlesController],
  providers: [ProductBundlesService],
  exports: [ProductBundlesService],
})
export class ProductBundlesModule {}
