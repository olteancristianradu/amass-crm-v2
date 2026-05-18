import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractTemplatesController } from './contract-templates.controller';
import { ContractTemplatesService } from './contract-templates.service';

/**
 * Phase 2 F1 — ContractTemplatesModule.
 *
 * Routes (all behind JwtAuthGuard + RolesGuard):
 *   POST   /contract-templates           create (DRAFT by default)
 *   GET    /contract-templates           list (filter by status)
 *   GET    /contract-templates/:id       get single
 *   PATCH  /contract-templates/:id       update (immutable on PUBLISHED+used)
 *   DELETE /contract-templates/:id       soft delete (sets ARCHIVED+deletedAt)
 *
 * Templates are reusable across many Contract rows. Bumping a template
 * never affects in-flight ceremonies because Contract.templateId pins the
 * exact version used at send time.
 */
@Module({
  imports: [AuthModule],
  controllers: [ContractTemplatesController],
  providers: [ContractTemplatesService],
  exports: [ContractTemplatesService],
})
export class ContractTemplatesModule {}
