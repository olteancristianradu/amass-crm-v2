import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { HealthController } from './health.controller';

// RedisService is exposed by the @Global RedisModule already imported at the
// root; no explicit import is needed here, but we keep PrismaModule listed for
// clarity because PrismaService is consumed by the controller.
// AuthModule is imported so JwtAuthGuard (used by /health/detailed) can
// resolve JwtService.
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
})
export class HealthModule {}
