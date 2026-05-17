import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// MetricsModule is @Global() — BusinessMetricsService is resolvable here
// without an explicit import. UsersService receives it via DI for the
// locale-switch counter (Phase 0 / Feature 1).
@Module({
  imports: [AuthModule, AuditModule, AccessControlModule],
  controllers: [UsersController],
  providers: [UsersService],
  // Export so future modules (BE template rendering) can inject
  // UsersService.resolveMyLocale() without rebuilding the cascade.
  exports: [UsersService],
})
export class UsersModule {}
