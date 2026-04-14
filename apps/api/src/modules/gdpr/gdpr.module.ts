import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [GdprService],
  controllers: [GdprController],
  exports: [GdprService],
})
export class GdprModule {}
