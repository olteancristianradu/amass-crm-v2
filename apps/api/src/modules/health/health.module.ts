import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BackupHealthService } from './backup-health.service';
import { HealthController } from './health.controller';

// RedisService is exposed by the @Global RedisModule already imported at the
// root; no explicit import is needed here, but we keep PrismaModule listed for
// clarity because PrismaService is consumed by the controller.
// AuthModule is imported so JwtAuthGuard (used by /health/detailed) can
// resolve JwtService.
//
// BackupHealthService is registered here (a sibling to the health controller)
// because its job — observing the freshness of the latest pg_dump — is
// conceptually a health check. ScheduleModule.forRoot() is already imported
// at the app level via SchedulerModule (apps/api/src/infra/scheduler), so we
// do not register it again here — @nestjs/schedule's metadata explorer picks
// up the @Cron decorator on any provider in the DI tree.
// Prom-client Gauge for `backup_last_success_timestamp_seconds` is provided
// by the @Global MetricsModule — no additional import needed.
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
  providers: [BackupHealthService],
})
export class HealthModule {}
