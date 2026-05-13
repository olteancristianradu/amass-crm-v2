import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is HOISTED above all imports + const declarations, so any
// captured-mock references must use vi.hoisted to share the same
// reference across the boundary.
const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn((_ctx: unknown, fn: () => void) => fn()),
}));

vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({ JWT_SECRET: 'test-secret-min-32-chars-padding' })),
}));

vi.mock('../../infra/prisma/tenant-context', () => ({
  tenantStorage: { run: runMock },
}));

import { TenantContextMiddleware } from './tenant-context.middleware';

function req(authHeader: string | undefined) {
  return { headers: authHeader ? { authorization: authHeader } : {} } as any;
}

function build() {
  const verify = vi.fn();
  const jwt = { verify } as unknown as JwtService;
  return { mw: new TenantContextMiddleware(jwt), verify };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TenantContextMiddleware', () => {
  it('calls next() without ALS context when no Authorization header is present', () => {
    const { mw, verify } = build();
    const next = vi.fn();
    mw.use(req(undefined), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('calls next() without ALS context for non-Bearer schemes', () => {
    const { mw, verify } = build();
    const next = vi.fn();
    mw.use(req('Basic abc'), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
  });

  it('skips JWT verification for non-JWT-shaped tokens (system/SCIM tokens)', () => {
    const { mw, verify } = build();
    const next = vi.fn();
    // Static system token, no dots → not a JWT.
    mw.use(req('Bearer static-system-token-no-dots'), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('opens tenantStorage with payload.tid/sub/role on a valid JWT', () => {
    const { mw, verify } = build();
    (verify as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      tid: 'tenant-1',
      sub: 'user-1',
      role: 'AGENT',
    });
    const next = vi.fn();
    mw.use(req('Bearer a.b.c'), {} as any, next);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0]![0]).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'AGENT',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws UnauthorizedException INVALID_TOKEN on a corrupt/expired JWT', () => {
    const { mw, verify } = build();
    (verify as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });
    const next = vi.fn();
    try {
      mw.use(req('Bearer a.b.c'), {} as any, next);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toMatchObject({
        code: 'INVALID_TOKEN',
      });
    }
    // Critical: next() MUST NOT be called on JWT failure — that's the
    // M-aud-H2 fix (no silent fall-through to a no-context query path).
    expect(next).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });
});
