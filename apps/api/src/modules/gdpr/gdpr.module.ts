import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';

// StorageModule provides StorageService used by erase flows to scrub MinIO
// blobs alongside the DB rows (GDPR Art. 17 cascade).
@Module({
  imports: [PrismaModule, AuditModule, AuthModule, AccessControlModule, StorageModule],
  providers: [GdprService],
  controllers: [GdprController],
  exports: [GdprService],
})
export class GdprModule {}
