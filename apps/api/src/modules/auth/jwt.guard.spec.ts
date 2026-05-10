import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from './jwt.guard';
import {
  JWT_BLOCKLIST_PREFIX,
  TENANT_SUSPENDED_PREFIX,
  USER_REVOKED_BEFORE_PREFIX,
} from './auth.service';

const validPayload = {
  sub: 'user-1',
  tid: 'tenant-1',
  email: 'andrei@firma.ro',
  role: 'AGENT' as const,
  jti: 'jti-1',
  exp: Math.floor(Date.now() / 1000) + 900,
  iat: Math.floor(Date.now() / 1000),
};

function ctx(headers: Record<string, string | undefined> = {}): ExecutionContext {
  const req: { headers: typeof headers; user?: unknown } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function build() {
  const jwt = { verifyAsync: vi.fn() } as unknown as JwtService;
  const store = new Map<string, string>();
  const redis = {
    client: {
      exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
    },
  } as unknown as ConstructorParameters<typeof JwtAuthGuard>[1];
  const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
  const guard = new JwtAuthGuard(jwt, redis, reflector);
  return { guard, jwt, redis, reflector, store };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JwtAuthGuard', () => {
  it('lets @Public() routes through without checking the token', async () => {
    const { guard, reflector, jwt } = build();
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const ok = await guard.canActivate(ctx({ authorization: undefined }));

    expect(ok).toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects requests without a Bearer token (NO_TOKEN)', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx({}))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx({ authorization: 'Basic abc' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tampered/expired tokens (INVALID_TOKEN)', async () => {
    const { guard, jwt } = build();
    (jwt.verifyAsync as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('jwt malformed'));
    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer x.y.z' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens missing jti or exp (defensive against pre-rotation tokens)', async () => {
    const { guard, jwt } = build();
    (jwt.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...validPayload,
      jti: undefined,
    });
    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer x.y.z' })),
    ).rejects.toThrow(/missing required claims/i);
  });

  it('rejects tokens whose jti is in the revocation blocklist (TOKEN_REVOKED)', async () => {
    const { guard, jwt, store } = build();
    (jwt.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validPayload);
    store.set(`${JWT_BLOCKLIST_PREFIX}${validPayload.jti}`, '1');

    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer x.y.z' })),
    ).rejects.toThrow(/revoked/i);
  });

  it('rejects tokens issued before user_revoked_before (force-logout window)', async () => {
    const { guard, jwt, store } = build();
    const future = validPayload.iat + 60; // logout fired AFTER token was issued
    (jwt.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validPayload);
    store.set(`${USER_REVOKED_BEFORE_PREFIX}${validPayload.sub}`, String(future));

    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer x.y.z' })),
    ).rejects.toThrow(/revoked/i);
  });

  it('rejects all requests when tenant is suspended (kill switch)', async () => {
    const { guard, jwt, store } = build();
    (jwt.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validPayload);
    store.set(`${TENANT_SUSPENDED_PREFIX}${validPayload.tid}`, '1');

    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer x.y.z' })),
    ).rejects.toThrow(/suspendat/i);
  });

  it('attaches AuthenticatedUser to request on a valid token', async () => {
    const { guard, jwt } = build();
    (jwt.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validPayload);
    const c = ctx({ authorization: 'Bearer good.token' });

    const ok = await guard.canActivate(c);
    expect(ok).toBe(true);

    const req = c.switchToHttp().getRequest<{ user?: { userId: string; tenantId: string } }>();
    expect(req.user).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'andrei@firma.ro',
      role: 'AGENT',
      jti: 'jti-1',
      exp: validPayload.exp,
    });
  });
});
