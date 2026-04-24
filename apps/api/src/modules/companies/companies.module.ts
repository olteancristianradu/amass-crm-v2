import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

/**
 * CompaniesModule — B2B account records.
 *
 * Routes (all behind JwtAuthGuard + RolesGuard):
 *   POST   /companies          create   (AGENT+)
 *   GET    /companies          list     (VIEWER+, cursor pagination, q=...)
 *   GET    /companies/:id      read     (VIEWER+)
 *   PATCH  /companies/:id      update   (AGENT+)
 *   DELETE /companies/:id      soft del (MANAGER+)
 *
 * Side effects on every mutation:
 *   - audit.log()    → security trail (audit_logs table)
 *   - activities.log() → user-visible timeline (activities table, action
 *                        = "company.created" / "company.updated" / "company.deleted")
 *
 * Imports AuthModule for JwtAuthGuard. ActivitiesService + AuditService
 * come from their @Global modules — no explicit import needed.
 */
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
