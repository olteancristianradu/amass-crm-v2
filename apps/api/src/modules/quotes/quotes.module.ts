import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivitiesModule } from '../activities/activities.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [AuthModule, ActivitiesModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
