import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global Prisma module — exports a single PrismaService instance to the
 * whole app. Marked @Global so feature modules can inject PrismaService
 * without listing this in every module's `imports`.
 *
 * For tenant-scoped queries, use `prisma.runWithTenant(tenantId, fn)` —
 * it sets `app.tenant_id` and `SET LOCAL ROLE app_user` so RLS kicks in.
 * Direct `prisma.X.method()` calls bypass RLS (postgres role is superuser
 * for migrations) and are only safe for pre-tenant lookups in AuthService.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
