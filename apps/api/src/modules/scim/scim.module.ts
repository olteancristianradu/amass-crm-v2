import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { parseTtlSeconds } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ScimAdminController } from './scim-admin.controller';
import { ScimBearerGuard } from './scim-bearer.guard';
import { ScimController } from './scim.controller';
import { ScimGroupsService } from './scim-groups.service';
import { ScimMetaController } from './scim-meta.controller';
import { ScimService } from './scim.service';
import { ScimTokenService } from './scim-token.service';

/**
 * SCIM 2.0 provisioning.
 *
 * - B3-PR1 shipped /Users CRUD.
 * - B3-PR2 added /Groups (synthetic, role-mapped).
 * - B3-PR3 replaced the temporary `X-Tenant-Id` header with real bearer-token
 *   auth (`ScimBearerGuard` + `ScimTokenService`) and added a JWT-protected
 *   admin surface (`ScimAdminController`) for tenant OWNER/ADMIN to create
 *   + list + revoke tokens.
 * - B3-PR5 (this PR) lands the discovery surface: `ServiceProviderConfig`,
 *   `Schemas`, `ResourceTypes` (`ScimMetaController`). Public per RFC 7644
 *   §4 — IdP wizards probe these before any token exists. B3 epic complete.
 *
 * AuditService is provided by the global AuditModule, so no explicit import.
 * JwtModule is registered locally (NOT imported from AuthModule) to avoid a
 * circular dependency — same pattern as `AuditModule`.
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_SECRET,
          signOptions: { expiresIn: parseTtlSeconds(env.JWT_ACCESS_TTL) },
        };
      },
    }),
  ],
  controllers: [ScimController, ScimAdminController, ScimMetaController],
  providers: [ScimService, ScimGroupsService, ScimTokenService, ScimBearerGuard, JwtAuthGuard],
})
export class ScimModule {}
