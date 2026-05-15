import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { loadEnv, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import {
  AuthService,
  AuthTokens,
  SafeUser,
  SessionMeta,
  toSafeUser,
} from '../auth/auth.service';

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
    private readonly auth: AuthService,
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
   * Authentication challenge key — separate namespace from the registration
   * key so a stale register-challenge can't be replayed into an
   * authenticate-verify (different ceremony, different expected RP flags).
   */
  private authChallengeKey(userId: string): string {
    return `webauthn:auth-challenge:${userId}`;
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

  /**
   * Step 1/2 of the LOGIN ceremony — produce
   * PublicKeyCredentialRequestOptions for navigator.credentials.get().
   *
   * Pre-auth: no JWT yet, no tenant context in ALS. We deliberately mimic
   * the same shape as `auth.service.login`'s tenant-resolution branch:
   *   - tenantSlug given → look the user up under that slug
   *   - tenantSlug omitted + email matches in exactly ONE tenant → use it
   *   - tenantSlug omitted + email matches in multiple tenants → 409 with
   *     a picker payload (same UX as password login)
   *   - any other case (missing tenant, no user) → 401 INVALID_CREDENTIALS,
   *     identical to password login so account presence is not leaked
   *
   * Returns:
   *   - `options`: the JSON the browser feeds into
   *     navigator.credentials.get(). `allowCredentials` is populated with
   *     the user's registered passkeys so the picker UI is filtered.
   *   - `userId`: session-binding hint echoed back to the FE; the verify
   *     step trusts THIS value (not the WebAuthn response) when looking
   *     up the challenge + minting tokens. Returned in the response body
   *     because we cannot use a session cookie yet (no JWT).
   *
   * Note: `userId` is non-sensitive by itself — it is a cuid, not an
   * email — and gives no privileges. The signed assertion is still the
   * actual proof of identity verified in step 2.
   */
  async generateAuthenticationOptions(
    email: string,
    tenantSlug?: string,
  ): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; userId: string }> {
    const emailLower = email.toLowerCase();

    // Resolve the user pre-tenant-context. Direct prisma access matches
    // auth.service's login() flow — see the long block comment at the top
    // of auth.service for why this is exempt from runWithTenant.
    let user: { id: string; tenantId: string } | null = null;
    if (tenantSlug) {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (tenant) {
        user = await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: emailLower } },
          select: { id: true, tenantId: true },
        });
      }
    } else {
      const matches = await this.prisma.user.findMany({
        where: { email: emailLower, isActive: true },
        select: { id: true, tenantId: true },
      });
      if (matches.length === 1) {
        user = matches[0];
      }
      // Two+ matches: we deliberately fail INVALID_CREDENTIALS rather than
      // surfacing a tenant picker. With passkey login the FE doesn't need
      // the picker because each tenant has its own passkey; we can simply
      // ask the user to retry with tenantSlug. Multi-tenant disambiguation
      // for passkey login is a future UX call.
    }

    if (!user) {
      // INVALID_CREDENTIALS, NOT USER_NOT_FOUND — passkey login must not
      // leak account presence (same threat model as password login).
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    // Load passkeys for the user inside the tenant's RLS context. The
    // tenantExtension will scope this query to user.tenantId regardless
    // of what the caller passed in.
    const passkeys = await this.prisma.runWithTenant(user.tenantId, async (tx) => {
      return tx.passkey.findMany({
        where: { userId: user!.id, tenantId: user!.tenantId },
        select: { credentialId: true, transports: true },
      });
    });

    const options = await generateAuthenticationOptions({
      rpID: this.env.WEBAUTHN_RP_ID,
      // userVerification 'preferred' matches the register ceremony — if the
      // authenticator is capable, the browser will ask for biometric/PIN;
      // otherwise a touch is enough. 'required' would lock out older keys.
      userVerification: 'preferred',
      allowCredentials: passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransportFuture[],
      })),
    });

    await this.redis.client.set(this.authChallengeKey(user.id), options.challenge, 'EX', 300);

    return { options, userId: user.id };
  }

  /**
   * Step 2/2 of the LOGIN ceremony — verify the assertion and mint a
   * full `{ user, tokens }` envelope identical to /auth/login.
   *
   * SECURITY INVARIANTS:
   *   1. Counter regression check — if `newCounter <= oldCounter` the
   *      authenticator either ran the counter backwards (impossible for
   *      a non-cloned device) or didn't advance (sign of replay). Reject.
   *   2. credentialId lookup is tenant-scoped via the user's tenantId
   *      (which we pulled from the User row). A passkey created under
   *      tenant A is not visible under any other tenant's RLS context.
   *   3. The challenge is consumed (Redis DEL) ONLY on success. On
   *      failure it stays so the user can retry with another authenticator
   *      within the 5-min TTL — the assertion itself can't be replayed
   *      because the WebAuthn signature is bound to the challenge value.
   *   4. The tokens are minted via AuthService.issueTokensForUser so the
   *      session row is persisted with the same `ua`/`ip`/`expiresAt`
   *      semantics as password login.
   */
  async verifyAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
    meta?: SessionMeta,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const challenge = await this.redis.client.get(this.authChallengeKey(userId));
    if (!challenge) {
      throw new UnauthorizedException({
        code: 'WEBAUTHN_NO_CHALLENGE',
        message: 'No active authentication challenge — call /webauthn/authenticate/options first',
      });
    }

    // Look up the user behind the userId hint. If the hint was tampered
    // with (a different user's id), this lookup either fails OR resolves
    // to a different tenant — both paths fall through to the same
    // INVALID_CREDENTIALS surface so the response is uniform.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    // The browser returns response.id base64url-encoded; that's the SAME
    // encoding we persisted in passkeys.credential_id at registration time.
    // Scoped to the user's tenant — a passkey from tenant B with the same
    // credentialId (theoretically impossible, but defense in depth) would
    // not be returned here.
    const passkey = await this.prisma.runWithTenant(user.tenantId, async (tx) => {
      return tx.passkey.findFirst({
        where: { credentialId: response.id, userId, tenantId: user.tenantId },
      });
    });
    if (!passkey) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.env.WEBAUTHN_ORIGIN,
      expectedRPID: this.env.WEBAUTHN_RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        // counter is BigInt in DB but the library wants a number. The spec
        // caps counter at uint32 (4 bytes from authData), so the cast is
        // safe — even worst case 2^32 ≈ 4.3B is within Number.MAX_SAFE.
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      throw new UnauthorizedException({
        code: 'WEBAUTHN_VERIFICATION_FAILED',
        message: 'Could not verify assertion',
      });
    }

    const { newCounter } = verification.authenticationInfo;

    // SECURITY: counter regression check (cloned-credential defence).
    // If two devices share the same private key (cloned), they'd issue
    // increasing-but-uncoordinated counters; the one whose counter is now
    // behind the persisted value is a clone (or a replay). Reject without
    // updating either field — the legit device will succeed on its next
    // attempt and bump the counter as normal.
    //
    // Note: counter==0 is the "authenticator doesn't track counter" case,
    // common on roaming credentials (Yubikey FIDO2 + some platform keys).
    // We allow newCounter==0 ONLY when the persisted counter is also 0;
    // any other 0 is a regression from a real value and IS blocked.
    const oldCounter = Number(passkey.counter);
    if (newCounter <= oldCounter && !(newCounter === 0 && oldCounter === 0)) {
      throw new UnauthorizedException({
        code: 'WEBAUTHN_COUNTER_REGRESSION',
        message: 'Authenticator counter went backwards — possible cloned credential',
      });
    }

    // Atomic update inside tenant context — counter + lastUsedAt.
    await this.prisma.runWithTenant(user.tenantId, async (tx) => {
      await tx.passkey.update({
        where: { id: passkey.id },
        data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
      });
    });

    // One-shot challenge: drop AFTER counter update so a failure between
    // verify and DB-write leaves the challenge usable for retry.
    await this.redis.del(this.authChallengeKey(userId));

    const tokens = await this.auth.issueTokensForUser(user, meta);

    return { user: toSafeUser(user), tokens };
  }
}
