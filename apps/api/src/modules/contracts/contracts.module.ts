import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

/**
 * ContractsModule — legal agreements linked to companies.
 *
 * Routes (all behind JwtAuthGuard):
 *   POST   /contracts          create
 *   GET    /contracts          list (filter by companyId, status, expiringInDays)
 *   GET    /contracts/:id      get single
 *   PATCH  /contracts/:id      update
 *   DELETE /contracts/:id      soft delete
 */
@Module({
  imports: [AuthModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
