import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EntityHealthController } from './entity-health.controller';
import { EntityHealthService } from './entity-health.service';

// AuthModule supplies JwtService for JwtAuthGuard — same pattern as
// CockpitModule (commit 2346629). Without it e2e crashes on app.init().
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EntityHealthController],
  providers: [EntityHealthService],
})
export class EntityHealthModule {}
