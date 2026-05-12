import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({})),
}));

import { loadEnv } from '../../config/env';
import { SystemApiKeyGuard } from './system-api-key.guard';

const loadEnvMock = loadEnv as unknown as ReturnType<typeof vi.fn>;

function ctx(authHeader: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  } as unknown as ExecutionContext;
}

// Use mockReturnValue (not Once) so the env stays stable across the
// guard's single loadEnv() call AND across tests where canActivate
// short-circuits before loadEnv runs (would otherwise queue stale
// values that leak into the next test).
beforeEach(() => {
  loadEnvMock.mockReset();
  loadEnvMock.mockReturnValue({ AI_WORKER_SECRET: 'super-secret-token' });
});

describe('SystemApiKeyGuard', () => {
  it('throws SYSTEM_AUTH_REQUIRED when no Authorization header is present', () => {
    const guard = new SystemApiKeyGuard();
    try {
      guard.canActivate(ctx(undefined));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'SYSTEM_AUTH_REQUIRED',
      });
    }
  });

  it('throws SYSTEM_AUTH_REQUIRED for non-Bearer schemes (Basic, etc.)', () => {
    const guard = new SystemApiKeyGuard();
    expect(() => guard.canActivate(ctx('Basic abc'))).toThrow(ForbiddenException);
  });

  it('throws INVALID_SYSTEM_API_KEY when AI_WORKER_SECRET env is unset', () => {
    loadEnvMock.mockReturnValue({});
    const guard = new SystemApiKeyGuard();
    try {
      guard.canActivate(ctx('Bearer anything'));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'INVALID_SYSTEM_API_KEY',
      });
    }
  });

  it('rejects token of wrong length (length-check guards timingSafeEqual throw)', () => {
    const guard = new SystemApiKeyGuard();
    // Default env is 'super-secret-token' (18 chars); 'short' is 5 chars.
    expect(() => guard.canActivate(ctx('Bearer short'))).toThrow(ForbiddenException);
  });

  it('rejects token of same length but different bytes (constant-time mismatch)', () => {
    loadEnvMock.mockReturnValue({ AI_WORKER_SECRET: 'abcdef-0123456789' });
    const guard = new SystemApiKeyGuard();
    expect(() =>
      guard.canActivate(ctx('Bearer abcdef-9876543210')),
    ).toThrow(ForbiddenException);
  });

  it('returns true on exact match (happy path)', () => {
    const guard = new SystemApiKeyGuard();
    expect(guard.canActivate(ctx('Bearer super-secret-token'))).toBe(true);
  });
});
