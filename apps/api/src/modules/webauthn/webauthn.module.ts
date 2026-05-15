import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebauthnController } from './webauthn.controller';
import { WebauthnService } from './webauthn.service';

/**
 * B2 — FIDO2/WebAuthn module.
 *
 * PR1 wires the registration ceremony (options + verify). The login
 * ceremony (authenticate options + verify) is intentionally left as 501
 * stubs in the controller; it lands in PR2 together with auth.service
 * integration.
 *
 * Storage:
 *   - Passkey rows live in Postgres (tenant-scoped, RLS-enforced).
 *   - Challenges live in Redis with a 5min TTL (WebAuthn spec recommendation).
 *
 * AuthModule is imported because both register endpoints are guarded by
 * JwtAuthGuard — the user has to be logged in (via password / TOTP) to
 * enrol a new authenticator.
 */
@Module({
  imports: [AuthModule],
  controllers: [WebauthnController],
  providers: [WebauthnService],
  exports: [WebauthnService],
})
export class WebauthnModule {}
