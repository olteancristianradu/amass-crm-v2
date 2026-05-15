import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { loadEnv, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Injection token for the validated env. We do not import loadEnv() at the
 * module top level inside the service so that tests can inject a fake env
 * without invoking the Zod parse on the live process.env.
 */
export const WEBAUTHN_ENV = Symbol('WEBAUTHN_ENV');

/**
 * B2-PR1: WebAuthn / FIDO2 passkey REGISTRATION flow.
 *
 * Login (authenticate-options + authenticate-verify) is intentionally left
 * out — it lands in B2-PR2 together with the auth.service integration.
 *
 * Ceremony (4 calls total, 2 here, 2 in PR2):
 *   1. POST /webauthn/register/options    → PublicKeyCredentialCreationOptions  (this PR)
 *   2. POST /webauthn/register/verify     → persist Passkey row                 (this PR)
 *   3. POST /webauthn/authenticate/options → PublicKeyCredentialRequestOptions  (PR2 — still 501)
 *   4. POST /webauthn/authenticate/verify  → mint session                       (PR2 — still 501)
 *
 * Challenge storage: Redis with a 5min TTL (WebAuthn spec recommendation,
 * matches the default timeout of the browser-side ceremony).
 *
 * Multi-tenancy: every passkey row carries (tenantId, userId). Writes go
 * through `runWithTenant(tenantId, ...)` so RLS + tenantExtension scope the
 * INSERT. Reads of the user's existing credentials (for excludeCredentials)
 * use the same wrapper. A passkey registered under tenant A is invisible to
 * any query running under tenant B's context.
 */
@Injectable()
export class WebauthnService {
  private readonly env: Env;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() @Inject(WEBAUTHN_ENV) env?: Env,
  ) {
    // Optional inject so tests can pass a fake env; falls back to loadEnv()
    // in production. WEBAUTHN_ENV is NOT registered as a provider in
    // webauthn.module.ts on purpose — production reads via loadEnv(). Nest
    // throws "Can't resolve dependencies" without @Optional() when the
    // token is absent (verified by e2e regression on commit c357962).
    this.env = env ?? loadEnv();
  }

  /**
   * Redis key for the per-user pending challenge. Keyed by userId because the
   * register ceremony is tied to an authenticated session — only the JWT
   * holder can complete the verify step. TTL = 300s (5min) matches the
   * WebAuthn-spec default ceremony timeout.
   */
  private challengeKey(userId: string): string {
    return `webauthn:challenge:${userId}`;
  }

  /**
   * Step 1/2 — generate the PublicKeyCredentialCreationOptions JSON that the
   * browser passes to navigator.credentials.create(). Persists the random
   * challenge in Redis so the verify step can match it.
   */
  async generateRegistrationOptions(
    userId: string,
    tenantId: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    // Load user + existing passkeys under the tenant context. The
    // tenantExtension auto-scopes both queries to (tenantId), so even if a
    // future bug leaked userId across tenants the lookup would still return
    // nothing for the wrong tenant.
    const { user, existing } = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { id: userId, tenantId } });
      if (!u) {
        throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });
      }
      const e = await tx.passkey.findMany({
        where: { userId, tenantId },
        select: { credentialId: true, transports: true },
      });
      return { user: u, existing: e };
    });

    const options = await generateRegistrationOptions({
      rpName: this.env.WEBAUTHN_RP_NAME,
      rpID: this.env.WEBAUTHN_RP_ID,
      userName: user.email,
      userDisplayName: user.fullName,
      // v11+: userID must be Uint8Array. The cuid is ASCII so UTF-8 encoding
      // round-trips losslessly. Same bytes go back into the assertion at
      // verify time — the library writes them into clientDataJSON.user.id.
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      // Don't let the same authenticator register twice — the browser will
      // refuse to use any credentialId in this list. transports is a hint
      // for the picker UI.
      excludeCredentials: existing.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Persist the challenge. The library returns it base64url-encoded; we
    // store the string as-is and pass it back unchanged to verifyRegistration.
    await this.redis.client.set(this.challengeKey(userId), options.challenge, 'EX', 300);

    return options;
  }

  /**
   * Step 2/2 — verify the attestation the browser produced. On success,
   * persists a Passkey row scoped to (tenantId, userId) and clears the
   * one-shot Redis challenge.
   */
  async verifyRegistration(
    userId: string,
    tenantId: string,
    response: RegistrationResponseJSON,
    deviceName?: string,
  ): Promise<{ passkeyId: string; credentialId: string }> {
    const challenge = await this.redis.client.get(this.challengeKey(userId));
    if (!challenge) {
      // No challenge = either the user skipped step 1, the TTL expired, or
      // this is a replay attempt. Same response either way.
      throw new UnauthorizedException({
        code: 'WEBAUTHN_NO_CHALLENGE',
        message: 'No active registration challenge — call /webauthn/register/options first',
      });
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.env.WEBAUTHN_ORIGIN,
      expectedRPID: this.env.WEBAUTHN_RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      // verified=false means the cryptographic check failed (signature,
      // origin, challenge, or rpId mismatch). Treat as authentication
      // failure — surface nothing further about which check failed.
      throw new UnauthorizedException({
        code: 'WEBAUTHN_VERIFICATION_FAILED',
        message: 'Could not verify attestation',
      });
    }

    const { credential } = verification.registrationInfo;

    // INSERT inside runWithTenant so RLS + tenantExtension both stamp
    // tenantId. publicKey is stored as Bytes — the library hands us a
    // Uint8Array directly, Prisma accepts Buffer.from(...) for Bytes columns.
    const created = await this.prisma.runWithTenant(tenantId, async (tx) => {
      return tx.passkey.create({
        data: {
          tenantId,
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: (credential.transports ?? []) as string[],
          deviceName: deviceName ?? null,
        },
        select: { id: true, credentialId: true },
      });
    });

    // One-shot challenge — drop it so a replay of the same attestation
    // can't double-register. Even if Redis del fails, the unique index on
    // credentialId would block the second insert.
    await this.redis.del(this.challengeKey(userId));

    return { passkeyId: created.id, credentialId: created.credentialId };
  }
}
