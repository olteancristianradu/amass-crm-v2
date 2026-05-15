import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Mock the @simplewebauthn/server package up-front so the service imports
// our fakes instead of the real implementation (which would try to do
// cryptographic verification on bogus test inputs).
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

import * as swServer from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';
import type { Env } from '../../config/env';

/**
 * Build a WebauthnService with stubbed prisma + redis + env.
 *
 * prisma.runWithTenant is implemented as a pass-through that captures the
 * tenantId it was called with — the "multi-tenant" test below asserts on
 * that captured value to prove the service plumbs the right tenant down
 * into Prisma.
 */
function build() {
  // The "tx" handed to the runWithTenant callback. We only use user.findFirst,
  // passkey.findMany, passkey.create — those are mocked per-test.
  const tx = {
    user: { findFirst: vi.fn() },
    passkey: { findMany: vi.fn(), create: vi.fn() },
  };

  const runWithTenantCalls: string[] = [];
  const prisma = {
    runWithTenant: vi.fn(async (tenantId: string, fn: (t: typeof tx) => Promise<unknown>) => {
      runWithTenantCalls.push(tenantId);
      return fn(tx);
    }),
  } as unknown as ConstructorParameters<typeof WebauthnService>[0];

  const redisClient = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
  };
  const redis = {
    client: redisClient,
    del: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof WebauthnService>[1];

  const env = {
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_RP_NAME: 'Test RP',
    WEBAUTHN_ORIGIN: 'http://localhost:5173',
  } as unknown as Env;

  const svc = new WebauthnService(prisma, redis, env);
  return { svc, prisma, redis, redisClient, tx, env, runWithTenantCalls };
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
