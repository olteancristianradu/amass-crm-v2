import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerSubscriptionsController } from './customer-subscriptions.controller';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [CustomerSubscriptionsController],
  providers: [CustomerSubscriptionsService],
  exports: [CustomerSubscriptionsService],
})
export class CustomerSubscriptionsModule {}
