import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/**
 * TenantModule — per-tenant configuration that lives ABOVE the per-feature
 * modules (locale config, future tenant-wide flags). Lightweight on purpose:
 * one controller, one service, no extra dependencies beyond Auth (for the
 * JwtAuthGuard) and Audit (for the change log).
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
