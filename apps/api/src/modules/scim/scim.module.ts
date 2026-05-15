import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';

/**
 * SCIM 2.0 provisioning. B3-PR1 implements /Users CRUD; Groups (PR2),
 * bearer-token auth (PR3), and the ServiceProviderConfig/Schemas meta
 * endpoints (PR4) land in follow-up PRs. Wires the tenant-scoped Prisma
 * client via PrismaModule so the service can call `runWithTenant`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ScimController],
  providers: [ScimService],
})
export class ScimModule {}
