import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { AuditModule } from '../audit/audit.module';
import { RedisModule } from '../../infra/redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService, parseTtlSeconds } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtAuthGuard } from './jwt.guard';
import { PasswordResetService } from './password-reset.service';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';

/**
 * AuthModule — owns the auth surface area:
 *
 *   POST /auth/register   create tenant + first OWNER user (returns {user, tokens})
 *   POST /auth/login      authenticate against (tenantSlug, email, password)
 *   POST /auth/refresh    rotate refresh token (single-use, hashed)
 *   POST /auth/logout     revoke session row
 *   GET  /auth/me         current user from JWT
 *
 * Token model:
 *   - Access:  JWT (HS256), 15min, payload = {sub, tid, email, role}
 *   - Refresh: opaque random base64url, 30d, SHA-256 hashed in `sessions`
 *
 * Exported so other modules can guard their routes:
 *   - JwtAuthGuard (used by every feature controller)
 *   - JwtModule (re-exported so the guard can verify tokens)
 *   - AuthService (rare; mostly for internal admin scripts)
 *
 * Note: This is the ONLY module allowed to call `prisma.X.findUnique()`
 * directly (without runWithTenant). It does so via tenant-scoped unique
 * keys (`tenantId_email` compound, `refreshTokenHash`) so the queries
 * are still safe — see auth.service.ts for the rationale on each query.
 */
@Module({
  imports: [
    AuditModule,
    RedisModule,
    // Use registerAsync so loadEnv() is called lazily inside the factory,
    // not at module-load time. This prevents env validation errors during
    // test setup before process.env is populated.
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        // v11 @nestjs/jwt tightened expiresIn typing: string is only accepted
        // in `ms`-compatible form, so we convert once to seconds (number).
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: parseTtlSeconds(env.JWT_ACCESS_TTL) } };
      },
    }),
  ],
  controllers: [AuthController, TotpController],
  providers: [AuthService, JwtAuthGuard, TotpService, PasswordResetService, EmailVerificationService],
  exports: [AuthService, JwtAuthGuard, JwtModule, TotpService, PasswordResetService, EmailVerificationService],
})
export class AuthModule {}
