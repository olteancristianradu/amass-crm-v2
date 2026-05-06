import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CockpitController } from './cockpit.controller';
import { CockpitLayoutService, CockpitService } from './cockpit.service';

// AuthModule is imported so JwtAuthGuard (used in CockpitController) can
// resolve JwtService — without this the e2e suite fails on app.init()
// with "Nest can't resolve dependencies of the JwtAuthGuard".
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CockpitController],
  providers: [CockpitService, CockpitLayoutService],
})
export class CockpitModule {}
