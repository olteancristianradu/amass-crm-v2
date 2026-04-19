import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * LeadsModule — top-of-funnel prospecting.
 *
 * Routes (all behind JwtAuthGuard):
 *   POST   /leads              create
 *   GET    /leads              list (cursor pagination, filters)
 *   GET    /leads/:id          get single
 *   PATCH  /leads/:id          update
 *   POST   /leads/:id/convert  convert → Contact + Company + Deal (atomic)
 *   DELETE /leads/:id          soft delete
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
