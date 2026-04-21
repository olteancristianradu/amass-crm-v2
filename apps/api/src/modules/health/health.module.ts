import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { HealthController } from './health.controller';

// RedisService is exposed by the @Global RedisModule already imported at the
// root; no explicit import is needed here, but we keep PrismaModule listed for
// clarity because PrismaService is consumed by the controller.
@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
