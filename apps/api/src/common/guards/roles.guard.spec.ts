import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RolesGuard } from './roles.guard';

function ctx(user?: { role: string } | undefined): ExecutionContext {
  const req: { user?: unknown } = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function build(required: string[] | undefined) {
  const reflector = {
    getAllAndOverride: vi.fn(() => required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RolesGuard', () => {
  it('allows the request through when @Roles() metadata is absent', () => {
    const guard = build(undefined);
    expect(guard.canActivate(ctx({ role: 'AGENT' }))).toBe(true);
  });

  it('allows the request through when @Roles() is an empty list', () => {
    const guard = build([]);
    expect(guard.canActivate(ctx({ role: 'AGENT' }))).toBe(true);
  });

  it('throws ForbiddenException NO_USER when no user is attached', () => {
    const guard = build(['OWNER']);
    try {
      guard.canActivate(ctx(undefined));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as { code: string };
      expect(body.code).toBe('NO_USER');
    }
  });

  it('throws ForbiddenException INSUFFICIENT_ROLE when role is not in the allowed set', () => {
    const guard = build(['OWNER', 'ADMIN']);
    try {
      guard.canActivate(ctx({ role: 'AGENT' }));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe('INSUFFICIENT_ROLE');
      expect(body.message).toContain('OWNER');
      expect(body.message).toContain('ADMIN');
    }
  });

  it('returns true when role matches one of the required roles', () => {
    const guard = build(['OWNER', 'ADMIN', 'AGENT']);
    expect(guard.canActivate(ctx({ role: 'AGENT' }))).toBe(true);
  });

  it('is case-sensitive (lowercased role is rejected — matches the literal enum)', () => {
    const guard = build(['OWNER']);
    expect(() => guard.canActivate(ctx({ role: 'owner' }))).toThrow(ForbiddenException);
  });
});
