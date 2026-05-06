import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { CockpitController } from './cockpit.controller';
import { CockpitLayoutService, CockpitService } from './cockpit.service';

@Module({
  imports: [PrismaModule],
  controllers: [CockpitController],
  providers: [CockpitService, CockpitLayoutService],
})
export class CockpitModule {}
