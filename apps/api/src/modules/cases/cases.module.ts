import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

/**
 * CasesModule — internal support tickets.
 *
 * Routes (all behind JwtAuthGuard):
 *   POST   /cases          create (auto-numbered per tenant)
 *   GET    /cases          list (filter by status, priority, assignee, company)
 *   GET    /cases/:id      get single
 *   PATCH  /cases/:id      update (auto-stamps resolvedAt on terminal status)
 *   DELETE /cases/:id      soft delete
 */
@Module({
  imports: [AuthModule],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
