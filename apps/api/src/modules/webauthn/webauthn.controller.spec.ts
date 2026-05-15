import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

// Mock refresh-cookie BEFORE the controller import so commitTokensToCookie
// doesn't try to call the real res.setHeader on the express stub.
vi.mock('../auth/refresh-cookie', () => ({
  setRefreshCookie: vi.fn(),
  clearRefreshCookie: vi.fn(),
  readRefreshCookie: vi.fn(),
  REFRESH_COOKIE_NAME: 'amass_rt',
}));

import { setRefreshCookie } from '../auth/refresh-cookie';
import { WebauthnController } from './webauthn.controller';
import type { WebauthnService } from './webauthn.service';

/**
 * WebauthnController is a thin pass-through to WebauthnService for both
 * ceremony halves (register + authenticate). The authenticate verify
 * route ALSO commits the refresh token to an httpOnly cookie and strips
 * it from the body — mirroring AuthController.commitTokensToCookie.
 */

function makeSvc() {
  return {
    generateRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
  };
}

function makeAudit() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

function build(
  s: ReturnType<typeof makeSvc>,
  audit: ReturnType<typeof makeAudit> = makeAudit(),
) {
  return new WebauthnController(
    s as unknown as WebauthnService,
    audit as never,
  );
}

function fakeRes(): Response {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
}

function fakeReq(extras: { ip?: string; userAgent?: string } = {}): Request {
  return {
    ip: extras.ip ?? '127.0.0.1',
    headers: { 'user-agent': extras.userAgent ?? 'vitest' },
  } as unknown as Request;
}

const fakeUser = {
  userId: 'u1',
  tenantId: 't1',
  email: 'a@x.ro',
  role: 'AGENT',
  jti: 'jti-1',
  exp: 1,
} as const;

describe('WebauthnController.registerOptions', () => {
  it('passes userId + tenantId from CurrentUser into the service', async () => {
    const svc = makeSvc();
    svc.generateRegistrationOptions.mockResolvedValue({ challenge: 'C' });
    const ctrl = build(svc);

    const r = await ctrl.registerOptions(fakeUser);

    expect(svc.generateRegistrationOptions).toHaveBeenCalledWith('u1', 't1');
    expect(r).toEqual({ challenge: 'C' });
  });
});

describe('WebauthnController.registerVerify', () => {
  it('forwards body.response + body.deviceName plus (userId, tenantId) to verifyRegistration', async () => {
    const svc = makeSvc();
    svc.verifyRegistration.mockResolvedValue({ passkeyId: 'pk1', credentialId: 'C1' });
    const ctrl = build(svc);

    const innerResponse = {
      id: 'CRED',
      rawId: 'CRED',
      type: 'public-key' as const,
      response: { clientDataJSON: 'CDJ', attestationObject: 'AO' },
    };
    const body = { response: innerResponse, deviceName: 'My iPhone' };

    const r = await ctrl.registerVerify(body as Parameters<typeof ctrl.registerVerify>[0], fakeUser);
    expect(svc.verifyRegistration).toHaveBeenCalledWith('u1', 't1', innerResponse, 'My iPhone');
    expect(r).toEqual({ passkeyId: 'pk1', credentialId: 'C1' });
  });
});

describe('WebauthnController.authenticateOptions', () => {
  it('delegates email + tenantSlug to generateAuthenticationOptions', async () => {
    const svc = makeSvc();
    svc.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'AUTH_C' },
      userId: 'u1',
    });
    const ctrl = build(svc);

    const r = await ctrl.authenticateOptions({ email: 'a@x.ro', tenantSlug: 'acme' });

    expect(svc.generateAuthenticationOptions).toHaveBeenCalledWith('a@x.ro', 'acme');
    expect(r).toEqual({ options: { challenge: 'AUTH_C' }, userId: 'u1' });
  });
});

describe('WebauthnController.authenticateVerify', () => {
  it('forwards the assertion, commits refresh-token to cookie, strips it from body, returns {user, tokens}', async () => {
    const svc = makeSvc();
    svc.verifyAuthentication.mockResolvedValue({
      user: { id: 'u1', tenantId: 't1', email: 'a@x.ro', fullName: 'A', role: 'AGENT' },
      tokens: { accessToken: 'A_JWT', refreshToken: 'R_OPAQUE', expiresIn: 900 },
    });
    const ctrl = build(svc);

    const innerResponse = {
      id: 'CRED',
      rawId: 'CRED',
      type: 'public-key' as const,
      response: {
        clientDataJSON: 'CDJ',
        authenticatorData: 'AD',
        signature: 'SIG',
      },
    };
    const req = fakeReq({ ip: '203.0.113.1', userAgent: 'TestBrowser' });
    const res = fakeRes();
    const body = { userId: 'u1', response: innerResponse };

    const out = await ctrl.authenticateVerify(
      body as Parameters<typeof ctrl.authenticateVerify>[0],
      req,
      res,
    );

    // Service was called with (userId, response, meta from req)
    expect(svc.verifyAuthentication).toHaveBeenCalledWith('u1', innerResponse, {
      userAgent: 'TestBrowser',
      ipAddress: '203.0.113.1',
    });

    // Envelope matches /auth/login shape: { user, tokens }
    expect(out.user).toMatchObject({ id: 'u1', tenantId: 't1' });
    // Refresh token was stripped from body and committed to cookie
    expect(out.tokens.refreshToken).toBe('');
    expect(out.tokens.accessToken).toBe('A_JWT');
    expect(out.tokens.expiresIn).toBe(900);
    // setRefreshCookie was called with the raw token + 7-day TTL
    expect(setRefreshCookie).toHaveBeenCalledTimes(1);
    const cookieCall = vi.mocked(setRefreshCookie).mock.calls[0];
    expect(cookieCall[1]).toBe('R_OPAQUE');
    expect(cookieCall[2]).toBe(7 * 24 * 60 * 60);
  });
});

describe('WebauthnController.listDevices', () => {
  it('passes userId + tenantId from CurrentUser and wraps in { devices: [...] }', async () => {
    const svc = makeSvc();
    const fakeDevices = [
      {
        id: 'pk1',
        credentialId: 'CRED_A',
        deviceName: 'MacBook',
        transports: ['internal'],
        createdAt: new Date(),
        lastUsedAt: null,
      },
    ];
    svc.listDevices.mockResolvedValue(fakeDevices);
    const ctrl = build(svc);

    const r = await ctrl.listDevices(fakeUser);

    expect(svc.listDevices).toHaveBeenCalledWith('u1', 't1');
    expect(r).toEqual({ devices: fakeDevices });
  });
});

describe('WebauthnController.revokeDevice', () => {
  it('delegates to service.revokeDevice with the passkey id + caller scope', async () => {
    const svc = makeSvc();
    const audit = makeAudit();
    svc.revokeDevice.mockResolvedValue({ revokedId: 'pk1' });
    const ctrl = build(svc, audit);
    const req = fakeReq({ ip: '203.0.113.9', userAgent: 'TestBrowser' });

    const result = await ctrl.revokeDevice('pk1', fakeUser, req);

    // Service got the (passkeyId, userId, tenantId) triple from path + JWT.
    expect(svc.revokeDevice).toHaveBeenCalledWith('pk1', 'u1', 't1');
    // 204 — controller method returns void.
    expect(result).toBeUndefined();
  });

  it('writes a webauthn.device_revoked audit entry with the actor, tenant, IP, and UA', async () => {
    const svc = makeSvc();
    const audit = makeAudit();
    svc.revokeDevice.mockResolvedValue({ revokedId: 'pk1' });
    const ctrl = build(svc, audit);
    const req = fakeReq({ ip: '203.0.113.9', userAgent: 'TestBrowser' });

    await ctrl.revokeDevice('pk1', fakeUser, req);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'webauthn.device_revoked',
      subjectType: 'Passkey',
      subjectId: 'pk1',
      tenantId: 't1',
      actorId: 'u1',
      ipAddress: '203.0.113.9',
      userAgent: 'TestBrowser',
    });
  });

  it('does NOT audit when revoke throws (service-level failure short-circuits the audit call)', async () => {
    const svc = makeSvc();
    const audit = makeAudit();
    svc.revokeDevice.mockRejectedValue(new Error('not found'));
    const ctrl = build(svc, audit);
    const req = fakeReq();

    await expect(ctrl.revokeDevice('pk1', fakeUser, req)).rejects.toThrow('not found');
    // Audit is written AFTER the delete succeeds — a thrown revoke must
    // not log a misleading "device_revoked" event.
    expect(audit.log).not.toHaveBeenCalled();
  });
});
