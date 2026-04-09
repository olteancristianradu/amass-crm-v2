import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';

/**
 * PipelinesModule — read-only CRUD for sales pipelines and their stages.
 *
 * Made @Global so DealsService can inject PipelinesService without an
 * awkward forward reference (DealsService calls it on move to resolve the
 * target stage's type, and on create to default to the tenant's
 * isDefault pipeline).
 *
 * Write paths in S10 are exclusively the default-pipeline seed inside
 * AuthService.register(). An admin UI to create/rename pipelines lands
 * in a later sprint.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
