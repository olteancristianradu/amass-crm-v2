import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { parseTtlSeconds } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';

/**
 * GDPR consent management module.
 * - DB layer: append-only consent_records (RLS forced + REVOKE UPDATE/DELETE for app_user).
 * - Service layer: every grant/revoke writes audit log.
 * - HTTP layer: Cedar-gated, never exposes another tenant's records (RLS as belt-and-suspenders).
 *
 * Exports the service so other modules (email send pre-flight, marketing
 * automation, portal) can call hasConsent() before consent-gated actions.
 */
@Module({
  imports: [
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
  controllers: [ConsentsController],
  providers: [ConsentsService, JwtAuthGuard],
  exports: [ConsentsService],
})
export class ConsentsModule {}
