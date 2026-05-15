import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebauthnController } from './webauthn.controller';
import { WebauthnService } from './webauthn.service';

/**
 * B2 — FIDO2/WebAuthn module.
 *
 * Both ceremony halves wired:
 *   - PR1: registration (options + verify) — JwtAuthGuard, must be logged
 *     in via password/TOTP first to enrol a new authenticator.
 *   - PR2: authentication (options + verify) — @Public(), this IS the
 *     login flow. Calls AuthService.issueTokensForUser on a verified
 *     assertion to mint the same `{ user, tokens }` envelope as
 *     `/auth/login`.
 *
 * Storage:
 *   - Passkey rows live in Postgres (tenant-scoped, RLS-enforced).
 *   - Register + authenticate challenges live in Redis under separate
 *     prefixes (`webauthn:challenge:` vs `webauthn:auth-challenge:`),
 *     both 5min TTL.
 *
 * AuthModule import: required for AuthService (token minting after
 * passkey verify) AND for JwtAuthGuard (register endpoints). AuthModule
 * does NOT import WebauthnModule, so no forwardRef is needed today.
 */
@Module({
  imports: [AuthModule],
  controllers: [WebauthnController],
  providers: [WebauthnService],
  exports: [WebauthnService],
})
export class WebauthnModule {}
