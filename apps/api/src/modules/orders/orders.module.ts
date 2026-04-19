import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * OrdersModule — fulfillment tracking for confirmed quotes.
 *
 * Routes (all behind JwtAuthGuard):
 *   POST   /orders          create with line items (auto-numbered per tenant)
 *   GET    /orders          list (filter by status, company)
 *   GET    /orders/:id      get single (with items)
 *   PATCH  /orders/:id      update status/notes (auto-stamps lifecycle dates)
 *   DELETE /orders/:id      soft delete
 */
@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
