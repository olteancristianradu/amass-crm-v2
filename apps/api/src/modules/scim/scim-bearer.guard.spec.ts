import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScimBearerGuard, type ScimAuthenticatedRequest } from './scim-bearer.guard';

/**
 * Unit tests for ScimBearerGuard. We don't need a real HTTP server — we
 * fabricate the Nest ExecutionContext directly and assert on:
 *   - rejection paths (missing header, malformed header, unknown token,
 *     revoked token)
 *   - happy path attaching `req.scimTenantId` + emitting the audit entry
 */

function makeCtx(headers: Record<string, string | undefined>, extra: Partial<ScimAuthenticatedRequest> = {}) {
  const req: ScimAuthenticatedRequest = {
    headers,
    method: 'GET',
    path: '/scim/v2/Users',
    url: '/scim/v2/Users',
    ip: '203.0.113.5',
    ...extra,
  } as ScimAuthenticatedRequest;
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

describe('ScimBearerGuard', () => {
  const tokenService = { verifyToken: vi.fn() };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  let guard: ScimBearerGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new ScimBearerGuard(
      tokenService as never,
      audit as never,
    );
  });

  it('missing Authorization header → 401', async () => {
    const { ctx } = makeCtx({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(tokenService.verifyToken).not.toHaveBeenCalled();
  });

  it('malformed Authorization (not Bearer) → 401', async () => {
    const { ctx } = makeCtx({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(tokenService.verifyToken).not.toHaveBeenCalled();
  });

  it('empty Bearer (just "Bearer ") → 401', async () => {
    const { ctx } = makeCtx({ authorization: 'Bearer    ' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(tokenService.verifyToken).not.toHaveBeenCalled();
  });

  it('unknown / invalid token (verifyToken returns null) → 401', async () => {
    tokenService.verifyToken.mockResolvedValue(null);
    const { ctx } = makeCtx({ authorization: 'Bearer abc123' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(tokenService.verifyToken).toHaveBeenCalledWith('abc123');
  });

  it('revoked token (verifyToken returns null) → 401', async () => {
    // Same code path as "unknown" — the service collapses revoked + not-found
    // into a single null return. We still assert the API contract so a future
    // refactor that splits them gets caught here.
    tokenService.verifyToken.mockResolvedValue(null);
    const { ctx } = makeCtx({ authorization: 'Bearer revoked-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('valid token → req.scimTenantId set + audit entry emitted + returns true', async () => {
    tokenService.verifyToken.mockResolvedValue({ tenantId: 'tenant-A', tokenId: 'tok-1' });
    const { ctx, req } = makeCtx({ authorization: 'Bearer real-token', 'user-agent': 'okta/1.0' });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect(req.scimTenantId).toBe('tenant-A');
    expect(req.scimTokenId).toBe('tok-1');
    // Audit fire-and-forget — allow microtask to settle, then assert.
    await new Promise((r) => setImmediate(r));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-A',
        action: 'scim.api_call',
        subjectType: 'scim_token',
        subjectId: 'tok-1',
        metadata: expect.objectContaining({ method: 'GET', path: '/scim/v2/Users' }),
      }),
    );
  });

  it('accepts case-insensitive "bearer" prefix (curl + axios both work)', async () => {
    tokenService.verifyToken.mockResolvedValue({ tenantId: 'tenant-X', tokenId: 'tok-2' });
    const { ctx, req } = makeCtx({ authorization: 'bearer lowercase-prefix' });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.scimTenantId).toBe('tenant-X');
  });
});
