import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — must be declared before importing the controller.
vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({ NODE_ENV: 'test' })),
}));
vi.mock('./refresh-cookie', () => ({
  REFRESH_COOKIE_NAME: 'amass_rt',
  setRefreshCookie: vi.fn(),
  clearRefreshCookie: vi.fn(),
  readRefreshCookie: vi.fn(),
}));

import { AuthController } from './auth.controller';
import type { AuthService, AuthTokens } from './auth.service';
import type { PasswordResetService } from './password-reset.service';
import type { EmailVerificationService } from './email-verification.service';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from './refresh-cookie';

const mockSetCookie = vi.mocked(setRefreshCookie);
const mockClearCookie = vi.mocked(clearRefreshCookie);
const mockReadCookie = vi.mocked(readRefreshCookie);

/**
 * AuthController surface — register, login, refresh, logout, me, three
 * password-reset / email-verify endpoints. Every method delegates to a
 * service; the controller's actual logic is the cookie dance in
 * `commitTokensToCookie` and the refresh-token resolution chain
 * (cookie → JSON body fallback).
 */

function makeServices() {
  const auth = {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  };
  const passwordReset = {
    request: vi.fn(),
    confirm: vi.fn(),
  };
  const emailVerification = {
    confirm: vi.fn(),
  };
  return { auth, passwordReset, emailVerification };
}

function build(s: ReturnType<typeof makeServices>) {
  return new AuthController(
    s.auth as unknown as AuthService,
    s.passwordReset as unknown as PasswordResetService,
    s.emailVerification as unknown as EmailVerificationService,
  );
}

const sampleTokens: AuthTokens = {
  accessToken: 'access.jwt.abc',
  refreshToken: 'refresh.opaque.xyz',
} as never;

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: { 'user-agent': 'vitest/0.0' },
    ip: '127.0.0.1',
    cookies: {},
    ...overrides,
  } as never;
}

function makeRes() {
  // Express Response stub — passthrough mode only needs the methods our
  // controller calls. The real cookie writers are mocked at module level.
  return { cookie: vi.fn(), clearCookie: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthController.register', () => {
  it('forwards the DTO to AuthService.register and strips the refresh token from the JSON', async () => {
    const svc = makeServices();
    svc.auth.register.mockResolvedValue({ user: { id: 'u1' }, tokens: sampleTokens });
    const ctrl = build(svc);
    const res = makeRes();

    const dto = { email: 'a@b.com', password: 'P@ssword1', name: 'A', tenantSlug: 't1' };
    const result = await ctrl.register(dto as never, res);

    expect(svc.auth.register).toHaveBeenCalledWith(dto);
    expect(mockSetCookie).toHaveBeenCalledWith(res, 'refresh.opaque.xyz', 7 * 24 * 60 * 60, false);
    // refresh token stripped from JSON body (M-10) — only the cookie carries it.
    expect(result.tokens.refreshToken).toBe('');
    expect(result.tokens.accessToken).toBe('access.jwt.abc');
  });
});

describe('AuthController.login', () => {
  it('forwards user-agent + IP from the request to AuthService.login and strips refresh token', async () => {
    const svc = makeServices();
    svc.auth.login.mockResolvedValue({ user: { id: 'u1' }, tokens: sampleTokens });
    const ctrl = build(svc);
    const req = makeReq({ headers: { 'user-agent': 'Chrome/123' }, ip: '203.0.113.5' });
    const res = makeRes();

    const dto = { email: 'a@b.com', password: 'P@ssword1' };
    const result = await ctrl.login(dto as never, req, res);

    expect(svc.auth.login).toHaveBeenCalledWith(dto, {
      userAgent: 'Chrome/123',
      ipAddress: '203.0.113.5',
    });
    expect(result.tokens.refreshToken).toBe('');
    expect(mockSetCookie).toHaveBeenCalled();
  });
});

describe('AuthController.refresh', () => {
  it('prefers the httpOnly cookie over the JSON body when both are present', async () => {
    const svc = makeServices();
    mockReadCookie.mockReturnValue('cookie-token');
    svc.auth.refresh.mockResolvedValue({ tokens: sampleTokens });
    const ctrl = build(svc);

    await ctrl.refresh(makeReq(), makeRes(), { refreshToken: 'body-token' });

    expect(svc.auth.refresh).toHaveBeenCalledWith(
      { refreshToken: 'cookie-token' },
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
  });

  it('falls back to JSON body when the cookie is absent', async () => {
    const svc = makeServices();
    mockReadCookie.mockReturnValue(undefined);
    svc.auth.refresh.mockResolvedValue({ tokens: sampleTokens });
    const ctrl = build(svc);

    await ctrl.refresh(makeReq(), makeRes(), { refreshToken: 'body-token-fallback-long-enough' });

    expect(svc.auth.refresh).toHaveBeenCalledWith(
      { refreshToken: 'body-token-fallback-long-enough' },
      expect.anything(),
    );
  });

  it('throws REFRESH_MISSING when neither cookie nor body has a refresh token', async () => {
    const svc = makeServices();
    mockReadCookie.mockReturnValue(undefined);
    const ctrl = build(svc);

    await expect(ctrl.refresh(makeReq(), makeRes(), {})).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.auth.refresh).not.toHaveBeenCalled();
  });
});

describe('AuthController.logout', () => {
  it('passes the cookie refresh token + access-token jti/exp to AuthService.logout and clears the cookie', async () => {
    const svc = makeServices();
    mockReadCookie.mockReturnValue('cookie-token-x');
    svc.auth.logout.mockResolvedValue(undefined);
    const ctrl = build(svc);
    const res = makeRes();

    await ctrl.logout(makeReq(), res, {}, { userId: 'u1', jti: 'jti-1', exp: 9999999999 } as never);

    expect(svc.auth.logout).toHaveBeenCalledWith('cookie-token-x', 'jti-1', 9999999999);
    expect(mockClearCookie).toHaveBeenCalledWith(res, false);
  });

  it('still revokes the access token via jti when the refresh cookie is missing', async () => {
    const svc = makeServices();
    mockReadCookie.mockReturnValue(undefined);
    svc.auth.logout.mockResolvedValue(undefined);
    const ctrl = build(svc);
    const res = makeRes();

    await ctrl.logout(makeReq(), res, {}, { userId: 'u1', jti: 'jti-orphan', exp: 9999999999 } as never);

    // Empty refresh token, but jti still passed for access-token blocklist.
    expect(svc.auth.logout).toHaveBeenCalledWith('', 'jti-orphan', 9999999999);
    expect(mockClearCookie).toHaveBeenCalled();
  });

  it('honors a refresh token in the JSON body when the cookie is absent', async () => {
    const svc = makeServices();
    mockReadCookie.mockReturnValue(undefined);
    svc.auth.logout.mockResolvedValue(undefined);
    const ctrl = build(svc);

    await ctrl.logout(
      makeReq(),
      makeRes(),
      { refreshToken: 'body-refresh-token-long-enough' },
      { userId: 'u1', jti: 'jti-2', exp: 1 } as never,
    );

    expect(svc.auth.logout).toHaveBeenCalledWith('body-refresh-token-long-enough', 'jti-2', 1);
  });
});

describe('AuthController.me', () => {
  it('looks up the current user by userId from the JWT payload', async () => {
    const svc = makeServices();
    svc.auth.me.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A' });
    const ctrl = build(svc);

    const r = await ctrl.me({ userId: 'u1' } as never);
    expect(svc.auth.me).toHaveBeenCalledWith('u1');
    expect(r).toEqual({ id: 'u1', email: 'a@b.com', name: 'A' });
  });
});

describe('AuthController.requestPasswordReset', () => {
  it('forwards email + tenantSlug + IP from x-forwarded-for to PasswordResetService', async () => {
    const svc = makeServices();
    svc.passwordReset.request.mockResolvedValue({ resetUrl: null });
    const ctrl = build(svc);
    const req = makeReq({
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      ip: '10.0.0.1',
    });

    await ctrl.requestPasswordReset({ email: 'a@b.com', tenantSlug: 't1' } as never, req);
    // First IP in x-forwarded-for wins (the original client).
    expect(svc.passwordReset.request).toHaveBeenCalledWith('a@b.com', 't1', '203.0.113.7');
  });

  it('falls back to req.ip when x-forwarded-for is absent', async () => {
    const svc = makeServices();
    svc.passwordReset.request.mockResolvedValue({ resetUrl: null });
    const ctrl = build(svc);

    await ctrl.requestPasswordReset({ email: 'a@b.com', tenantSlug: 't1' } as never, makeReq());
    expect(svc.passwordReset.request).toHaveBeenCalledWith('a@b.com', 't1', '127.0.0.1');
  });
});

describe('AuthController.confirmPasswordReset', () => {
  it('forwards token + new password to PasswordResetService.confirm', async () => {
    const svc = makeServices();
    svc.passwordReset.confirm.mockResolvedValue(undefined);
    const ctrl = build(svc);

    await ctrl.confirmPasswordReset({ token: 'tok123', newPassword: 'NewP@ss1' } as never);
    expect(svc.passwordReset.confirm).toHaveBeenCalledWith('tok123', 'NewP@ss1');
  });
});

describe('AuthController.verifyEmail', () => {
  it('forwards the token to EmailVerificationService.confirm', async () => {
    const svc = makeServices();
    svc.emailVerification.confirm.mockResolvedValue(undefined);
    const ctrl = build(svc);

    await ctrl.verifyEmail({ token: 'verify-tok' } as never);
    expect(svc.emailVerification.confirm).toHaveBeenCalledWith('verify-tok');
  });
});
