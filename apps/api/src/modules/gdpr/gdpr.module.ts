import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, AccessControlModule],
  providers: [GdprService],
  controllers: [GdprController],
  exports: [GdprService],
})
export class GdprModule {}
