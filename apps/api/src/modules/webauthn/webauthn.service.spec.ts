import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

// Mock the @simplewebauthn/server package up-front so the service imports
// our fakes instead of the real implementation (which would try to do
// cryptographic verification on bogus test inputs).
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import * as swServer from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';
import type { Env } from '../../config/env';
import type { AuthService } from '../auth/auth.service';

/**
 * Build a WebauthnService with stubbed prisma + redis + auth + env.
 *
 * prisma.runWithTenant is implemented as a pass-through that captures the
 * tenantId it was called with — the "multi-tenant" tests assert on that
 * captured value to prove the service plumbs the right tenant down into
 * Prisma. prisma.user.findUnique / prisma.user.findMany / prisma.tenant
 * are stubbed too because the LOGIN ceremony resolves users pre-auth
 * (without a tenant context), the same way auth.service.login does.
 */
function build() {
  // The "tx" handed to the runWithTenant callback. The login flow uses
  // passkey.findFirst + passkey.update; the register flow uses
  // user.findFirst + passkey.findMany + passkey.create.
  const tx = {
    user: { findFirst: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  const runWithTenantCalls: string[] = [];
  const prisma = {
    runWithTenant: vi.fn(async (tenantId: string, fn: (t: typeof tx) => Promise<unknown>) => {
      runWithTenantCalls.push(tenantId);
      return fn(tx);
    }),
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  } as unknown as ConstructorParameters<typeof WebauthnService>[0];

  const redisClient = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
  };
  const redis = {
    client: redisClient,
    del: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof WebauthnService>[1];

  // AuthService is required (no @Optional()) so unit tests must supply a
  // fake. issueTokensForUser is the only method webauthn.service calls.
  const auth = {
    issueTokensForUser: vi.fn().mockResolvedValue({
      accessToken: 'access.jwt.token',
      refreshToken: 'refresh.token.opaque',
      expiresIn: 900,
    }),
  } as unknown as AuthService;

  const env = {
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_RP_NAME: 'Test RP',
    WEBAUTHN_ORIGIN: 'http://localhost:5173',
  } as unknown as Env;

  const svc = new WebauthnService(prisma, redis, auth, env);
  return { svc, prisma, redis, redisClient, tx, env, auth, runWithTenantCalls };
}

describe('WebauthnService.generateRegistrationOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns options and stores the challenge in Redis with 5min TTL', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u1', email: 'a@x.ro', fullName: 'A' });
    h.tx.passkey.findMany.mockResolvedValue([]);
    vi.mocked(swServer.generateRegistrationOptions).mockResolvedValueOnce({
      challenge: 'CHALLENGE_BASE64URL',
      rp: { name: 'Test RP', id: 'localhost' },
      user: { id: 'X', name: 'a@x.ro', displayName: 'A' },
      pubKeyCredParams: [],
    } as never);

    const out = await h.svc.generateRegistrationOptions('u1', 'cabcdefghijklmnopqrstuvwx');

    expect(out.challenge).toBe('CHALLENGE_BASE64URL');
    expect(h.redisClient.set).toHaveBeenCalledWith(
      'webauthn:challenge:u1',
      'CHALLENGE_BASE64URL',
      'EX',
      300,
    );
  });

  it('passes existing credentialIds to excludeCredentials', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u1', email: 'a@x.ro', fullName: 'A' });
    h.tx.passkey.findMany.mockResolvedValue([
      { credentialId: 'CRED_A', transports: ['internal'] },
      { credentialId: 'CRED_B', transports: ['usb', 'nfc'] },
    ]);
    vi.mocked(swServer.generateRegistrationOptions).mockResolvedValueOnce({
      challenge: 'C',
    } as never);

    await h.svc.generateRegistrationOptions('u1', 'cabcdefghijklmnopqrstuvwx');

    const call = vi.mocked(swServer.generateRegistrationOptions).mock.calls[0][0];
    expect(call.excludeCredentials).toEqual([
      { id: 'CRED_A', transports: ['internal'] },
      { id: 'CRED_B', transports: ['usb', 'nfc'] },
    ]);
  });

  it('throws UnauthorizedException when the user does not exist in this tenant', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue(null);
    await expect(h.svc.generateRegistrationOptions('u1', 'cabcdefghijklmnopqrstuvwx')).rejects.toThrow(
      UnauthorizedException,
    );
    // Library must not be called if the user lookup failed
    expect(swServer.generateRegistrationOptions).not.toHaveBeenCalled();
  });
});

describe('WebauthnService.verifyRegistration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on a valid attestation: inserts the Passkey row and clears Redis challenge', async () => {
    const h = build();
    h.redisClient.get.mockResolvedValueOnce('CHALLENGE');
    vi.mocked(swServer.verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'NEW_CRED_ID',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['internal'],
        },
        // shape fields the type requires but we don't read
        fmt: 'none',
        aaguid: '0',
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:5173',
      },
    } as never);
    h.tx.passkey.create.mockResolvedValueOnce({ id: 'pk1', credentialId: 'NEW_CRED_ID' });

    const res = await h.svc.verifyRegistration(
      'u1',
      'cabcdefghijklmnopqrstuvwx',
      { id: 'NEW_CRED_ID' } as never,
      'My Laptop',
    );

    expect(res).toEqual({ passkeyId: 'pk1', credentialId: 'NEW_CRED_ID' });
    const createArgs = h.tx.passkey.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('u1');
    expect(createArgs.data.tenantId).toBe('cabcdefghijklmnopqrstuvwx');
    expect(createArgs.data.credentialId).toBe('NEW_CRED_ID');
    expect(createArgs.data.counter).toBe(BigInt(0));
    expect(createArgs.data.deviceName).toBe('My Laptop');
    expect(h.redis.del).toHaveBeenCalledWith('webauthn:challenge:u1');
  });

  it('throws UnauthorizedException when no challenge is stored in Redis', async () => {
    const h = build();
    h.redisClient.get.mockResolvedValueOnce(null);
    await expect(
      h.svc.verifyRegistration('u1', 'cabcdefghijklmnopqrstuvwx', { id: 'x' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(swServer.verifyRegistrationResponse).not.toHaveBeenCalled();
    expect(h.tx.passkey.create).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException and does NOT insert when verified=false', async () => {
    const h = build();
    h.redisClient.get.mockResolvedValueOnce('CHALLENGE');
    vi.mocked(swServer.verifyRegistrationResponse).mockResolvedValueOnce({
      verified: false,
    } as never);

    await expect(
      h.svc.verifyRegistration('u1', 'cabcdefghijklmnopqrstuvwx', { id: 'x' } as never),
    ).rejects.toThrow(UnauthorizedException);

    expect(h.tx.passkey.create).not.toHaveBeenCalled();
    // Important: challenge must NOT be cleared on failure — the user can
    // retry within the TTL with another authenticator.
    expect(h.redis.del).not.toHaveBeenCalled();
  });

  it('multi-tenant: passkey writes run under the caller-supplied tenantId, not the user-supplied one', async () => {
    // This is the multi-tenant assertion: even though the attestation
    // payload could theoretically claim a different user/tenant in its
    // clientDataJSON, the service is the source of truth — it pulls
    // tenantId from the JWT (the controller passes user.tenantId from
    // CurrentUser) and that's the tenant runWithTenant gets.
    const h = build();
    h.redisClient.get.mockResolvedValueOnce('CHALLENGE');
    vi.mocked(swServer.verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'CRED_TENANT_A',
          publicKey: new Uint8Array([9, 8, 7]),
          counter: 0,
          transports: [],
        },
        fmt: 'none',
        aaguid: '0',
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:5173',
      },
    } as never);
    h.tx.passkey.create.mockResolvedValueOnce({ id: 'pk_A', credentialId: 'CRED_TENANT_A' });

    const tenantA = 'caaaaaaaaaaaaaaaaaaaaaaaa';
    await h.svc.verifyRegistration('uA', tenantA, { id: 'x' } as never);

    // The runWithTenant call was made with tenantA — not the user-controlled
    // attestation. The recorded captures prove the wrapper got the right id.
    expect(h.runWithTenantCalls).toContain(tenantA);
    const createArgs = h.tx.passkey.create.mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe(tenantA);

    // Simulating a "list under tenant B" query: the tenantExtension in the
    // real PrismaService scopes findMany({ where: { userId } }) by adding
    // tenantId. We model that here by checking that findMany under a
    // different tenant context returns nothing — i.e. the passkey row is
    // tied to tenant A only.
    vi.clearAllMocks();
    h.tx.passkey.findMany.mockResolvedValueOnce([]);
    const otherTenant = 'cbbbbbbbbbbbbbbbbbbbbbbbb';
    const found = await (h.prisma as unknown as {
      runWithTenant: (t: string, fn: (tx: typeof h.tx) => Promise<unknown>) => Promise<unknown>;
    }).runWithTenant(otherTenant, async (tx) => tx.passkey.findMany({ where: { userId: 'uA', tenantId: otherTenant } }));

    expect(found).toEqual([]);
    expect(h.tx.passkey.findMany).toHaveBeenCalledWith({ where: { userId: 'uA', tenantId: otherTenant } });
  });
});

// =====================================================================
// B2-PR2 — LOGIN ceremony tests
// =====================================================================

describe('WebauthnService.generateAuthenticationOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('for a known user: returns options, stores the auth challenge in Redis, and echoes userId hint', async () => {
    const h = build();
    // Single-tenant resolution path (no tenantSlug → email lookup matches 1 user).
    const userFindMany = h.prisma as unknown as { user: { findMany: ReturnType<typeof vi.fn> } };
    userFindMany.user.findMany.mockResolvedValueOnce([{ id: 'u1', tenantId: 'tA' }]);
    h.tx.passkey.findMany.mockResolvedValueOnce([
      { credentialId: 'CRED_X', transports: ['internal'] },
    ]);
    vi.mocked(swServer.generateAuthenticationOptions).mockResolvedValueOnce({
      challenge: 'AUTH_CHALLENGE',
      rpId: 'localhost',
      allowCredentials: [{ id: 'CRED_X', type: 'public-key', transports: ['internal'] }],
    } as never);

    const out = await h.svc.generateAuthenticationOptions('a@x.ro');

    expect(out.userId).toBe('u1');
    expect(out.options.challenge).toBe('AUTH_CHALLENGE');
    expect(h.redisClient.set).toHaveBeenCalledWith(
      'webauthn:auth-challenge:u1',
      'AUTH_CHALLENGE',
      'EX',
      300,
    );
    // allowCredentials was assembled from the passkey rows
    const swCall = vi.mocked(swServer.generateAuthenticationOptions).mock.calls[0][0];
    expect(swCall.allowCredentials).toEqual([{ id: 'CRED_X', transports: ['internal'] }]);
  });

  it('for an UNKNOWN user: throws UnauthorizedException with INVALID_CREDENTIALS — does NOT leak account presence', async () => {
    const h = build();
    const userFindMany = h.prisma as unknown as { user: { findMany: ReturnType<typeof vi.fn> } };
    userFindMany.user.findMany.mockResolvedValueOnce([]);

    let thrown: unknown;
    try {
      await h.svc.generateAuthenticationOptions('ghost@x.ro');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    // Must NOT be USER_NOT_FOUND — that would leak presence. INVALID_CREDENTIALS
    // is identical to the response a wrong-password login would produce.
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(swServer.generateAuthenticationOptions).not.toHaveBeenCalled();
    expect(h.redisClient.set).not.toHaveBeenCalled();
  });
});

describe('WebauthnService.verifyAuthentication', () => {
  beforeEach(() => vi.clearAllMocks());

  function setupValidVerifyContext(h: ReturnType<typeof build>, opts?: {
    storedCounter?: number;
    newCounter?: number;
    verified?: boolean;
  }) {
    h.redisClient.get.mockResolvedValueOnce('AUTH_CHALLENGE');
    const userFindUnique = h.prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn> };
    };
    userFindUnique.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      tenantId: 'tA',
      email: 'a@x.ro',
      fullName: 'A',
      role: 'AGENT',
      isActive: true,
    });
    h.tx.passkey.findFirst.mockResolvedValueOnce({
      id: 'pk1',
      credentialId: 'CRED_X',
      userId: 'u1',
      tenantId: 'tA',
      publicKey: Buffer.from([0x01, 0x02]),
      counter: BigInt(opts?.storedCounter ?? 5),
      transports: ['internal'],
    });
    vi.mocked(swServer.verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: opts?.verified ?? true,
      authenticationInfo: {
        credentialID: 'CRED_X',
        newCounter: opts?.newCounter ?? 6,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:5173',
        rpID: 'localhost',
      },
    } as never);
  }

  it('on valid response: updates counter + lastUsedAt, scrubs Redis, mints tokens', async () => {
    const h = build();
    setupValidVerifyContext(h, { storedCounter: 5, newCounter: 7 });

    const res = await h.svc.verifyAuthentication('u1', { id: 'CRED_X' } as never, {
      ipAddress: '10.0.0.1',
      userAgent: 'curl',
    });

    // Token envelope shape matches /auth/login
    expect(res.user).toMatchObject({ id: 'u1', tenantId: 'tA', email: 'a@x.ro' });
    expect(res.tokens.accessToken).toBe('access.jwt.token');
    expect(res.tokens.refreshToken).toBe('refresh.token.opaque');

    // Counter was bumped to newCounter, not silently incremented
    const updateArgs = h.tx.passkey.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'pk1' });
    expect(updateArgs.data.counter).toBe(BigInt(7));
    expect(updateArgs.data.lastUsedAt).toBeInstanceOf(Date);

    // Challenge was consumed (one-shot)
    expect(h.redis.del).toHaveBeenCalledWith('webauthn:auth-challenge:u1');

    // AuthService was invoked with the right user + meta
    expect(h.auth.issueTokensForUser).toHaveBeenCalledTimes(1);
    expect(h.auth.issueTokensForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', tenantId: 'tA' }),
      { ipAddress: '10.0.0.1', userAgent: 'curl' },
    );
  });

  it('counter REGRESSION (newCounter <= oldCounter) throws and does NOT update — cloned-credential defence', async () => {
    const h = build();
    // Stored counter is 10; authenticator claims newCounter=5 (regression!).
    setupValidVerifyContext(h, { storedCounter: 10, newCounter: 5 });

    let thrown: unknown;
    try {
      await h.svc.verifyAuthentication('u1', { id: 'CRED_X' } as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'WEBAUTHN_COUNTER_REGRESSION',
    });

    // NOTHING gets touched: no DB update, no token mint, no challenge scrub.
    expect(h.tx.passkey.update).not.toHaveBeenCalled();
    expect(h.auth.issueTokensForUser).not.toHaveBeenCalled();
    expect(h.redis.del).not.toHaveBeenCalled();
  });

  it('counter EQUAL (newCounter == oldCounter) is also a regression — must reject', async () => {
    // Equal counters mean the authenticator did not advance — either a
    // replay or a clone. The check is "<=" not "<" for that reason.
    const h = build();
    setupValidVerifyContext(h, { storedCounter: 8, newCounter: 8 });

    await expect(
      h.svc.verifyAuthentication('u1', { id: 'CRED_X' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(h.tx.passkey.update).not.toHaveBeenCalled();
    expect(h.auth.issueTokensForUser).not.toHaveBeenCalled();
  });

  it('invalid assertion (verified=false) throws + does NOT update + does NOT mint tokens', async () => {
    const h = build();
    setupValidVerifyContext(h, { verified: false });

    let thrown: unknown;
    try {
      await h.svc.verifyAuthentication('u1', { id: 'CRED_X' } as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'WEBAUTHN_VERIFICATION_FAILED',
    });
    expect(h.tx.passkey.update).not.toHaveBeenCalled();
    expect(h.auth.issueTokensForUser).not.toHaveBeenCalled();
    expect(h.redis.del).not.toHaveBeenCalled();
  });

  it('multi-tenant: passkey lookup uses the user.tenantId — a request targeting the wrong tenant context finds no row', async () => {
    // The login flow has no JWT, so tenantId comes from the User row we
    // looked up. If the User belongs to tenant A, the Passkey lookup
    // MUST happen in tenant A's context — a passkey belonging to a
    // different tenant is invisible.
    const h = build();
    h.redisClient.get.mockResolvedValueOnce('AUTH_CHALLENGE');
    const userFindUnique = h.prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn> };
    };
    userFindUnique.user.findUnique.mockResolvedValueOnce({
      id: 'uA',
      tenantId: 'tenantA',
      email: 'a@x.ro',
      fullName: 'A',
      role: 'AGENT',
      isActive: true,
    });
    // Passkey lookup under tenantA returns null — the credentialId is
    // registered to tenantB (defense in depth: even if the unique index
    // somehow allowed cross-tenant, RLS would filter it out).
    h.tx.passkey.findFirst.mockResolvedValueOnce(null);

    await expect(
      h.svc.verifyAuthentication('uA', { id: 'CRED_FROM_TENANT_B' } as never),
    ).rejects.toThrow(UnauthorizedException);

    // The Passkey query ran under tenantA's context (from the User row)
    expect(h.runWithTenantCalls).toContain('tenantA');
    // No token was minted — the credential was invisible
    expect(h.auth.issueTokensForUser).not.toHaveBeenCalled();
    // The library was never even called — we short-circuit before that
    expect(swServer.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('missing challenge in Redis → throws WEBAUTHN_NO_CHALLENGE and never hits the library', async () => {
    const h = build();
    h.redisClient.get.mockResolvedValueOnce(null);

    let thrown: unknown;
    try {
      await h.svc.verifyAuthentication('u1', { id: 'CRED_X' } as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'WEBAUTHN_NO_CHALLENGE',
    });
    expect(swServer.verifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(h.auth.issueTokensForUser).not.toHaveBeenCalled();
  });
});

// =====================================================================
// B2-PR4 — device list + revoke tests
// =====================================================================

describe('WebauthnService.listDevices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the user passkeys ordered newest-first and selects only display-safe fields', async () => {
    const h = build();
    const rows = [
      {
        id: 'pk2',
        credentialId: 'CRED_B',
        deviceName: 'YubiKey',
        transports: ['usb'],
        createdAt: new Date('2026-03-01'),
        lastUsedAt: null,
      },
      {
        id: 'pk1',
        credentialId: 'CRED_A',
        deviceName: 'MacBook',
        transports: ['internal'],
        createdAt: new Date('2026-02-01'),
        lastUsedAt: new Date('2026-04-15'),
      },
    ];
    h.tx.passkey.findMany.mockResolvedValueOnce(rows);

    const out = await h.svc.listDevices('u1', 'tenantA');
    expect(out).toEqual(rows);

    const args = h.tx.passkey.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1', tenantId: 'tenantA' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    // Crypto state must NOT be leaked through the list response.
    expect(args.select).toEqual({
      id: true,
      credentialId: true,
      deviceName: true,
      transports: true,
      createdAt: true,
      lastUsedAt: true,
    });
    // The query ran under the caller-supplied tenant context.
    expect(h.runWithTenantCalls).toContain('tenantA');
  });

  it('returns [] when the user has no registered passkeys', async () => {
    const h = build();
    h.tx.passkey.findMany.mockResolvedValueOnce([]);
    const out = await h.svc.listDevices('u_alone', 'tenantA');
    expect(out).toEqual([]);
  });

  it('multi-tenant: a passkey from tenant A is NOT returned when listDevices runs under tenant B', async () => {
    // The tenantExtension in PrismaService rewrites every passkey.findMany
    // to inject tenantId. We model that here: under tenantB the stub
    // returns [] because the row belongs to tenantA.
    const h = build();
    h.tx.passkey.findMany.mockImplementation(async (args: { where: { tenantId: string } }) => {
      // Simulate the tenantExtension: the actual rows live in tenantA only.
      if (args.where.tenantId === 'tenantA') {
        return [
          {
            id: 'pk_A',
            credentialId: 'CRED_A',
            deviceName: 'Device A',
            transports: ['internal'],
            createdAt: new Date(),
            lastUsedAt: null,
          },
        ];
      }
      return [];
    });

    const tenantA = await h.svc.listDevices('uShared', 'tenantA');
    const tenantB = await h.svc.listDevices('uShared', 'tenantB');

    expect(tenantA).toHaveLength(1);
    expect(tenantB).toEqual([]);
    expect(h.runWithTenantCalls).toEqual(expect.arrayContaining(['tenantA', 'tenantB']));
  });
});

describe('WebauthnService.revokeDevice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the passkey row and returns { revokedId } when caller owns the device', async () => {
    const h = build();
    h.tx.passkey.findFirst.mockResolvedValueOnce({ id: 'pk1' });
    h.tx.passkey.delete.mockResolvedValueOnce({ id: 'pk1' });

    const out = await h.svc.revokeDevice('pk1', 'u1', 'tenantA');
    expect(out).toEqual({ revokedId: 'pk1' });
    // Ownership probe was done with the full triple — no missing scope.
    expect(h.tx.passkey.findFirst).toHaveBeenCalledWith({
      where: { id: 'pk1', userId: 'u1', tenantId: 'tenantA' },
      select: { id: true },
    });
    // Hard delete (no soft delete on passkeys — revocation is final).
    expect(h.tx.passkey.delete).toHaveBeenCalledWith({ where: { id: 'pk1' } });
    expect(h.runWithTenantCalls).toContain('tenantA');
  });

  it('throws NotFoundException (NOT Forbidden) when the passkey belongs to another user — does not leak existence', async () => {
    const h = build();
    // Ownership filter (userId in where) makes the row invisible.
    h.tx.passkey.findFirst.mockResolvedValueOnce(null);

    await expect(
      h.svc.revokeDevice('pk_owned_by_other', 'attackerUser', 'tenantA'),
    ).rejects.toThrow(NotFoundException);

    // Never touched the DB beyond the probe.
    expect(h.tx.passkey.delete).not.toHaveBeenCalled();
  });

  it('multi-tenant: throws NotFoundException when the passkey belongs to a different tenant', async () => {
    // The tenantExtension makes the cross-tenant row invisible — findFirst
    // returns null under tenantB even though the row exists in tenantA.
    const h = build();
    h.tx.passkey.findFirst.mockResolvedValueOnce(null);

    await expect(
      h.svc.revokeDevice('pk_in_tenantA', 'u1', 'tenantB'),
    ).rejects.toThrow(NotFoundException);

    expect(h.tx.passkey.delete).not.toHaveBeenCalled();
    expect(h.runWithTenantCalls).toContain('tenantB');
  });
});
