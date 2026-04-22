import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CedarGuard } from './cedar.guard';
import { CedarPolicyService } from './cedar-policy.service';
import { CEDAR_METADATA_KEY, CedarRequirement } from './cedar.decorator';

function fakeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function build(requirement: CedarRequirement | null) {
  const cedar = new CedarPolicyService();
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (key: unknown) => (key === CEDAR_METADATA_KEY ? requirement : undefined) as never,
  );
  return new CedarGuard(cedar, reflector);
}

describe('CedarGuard', () => {
  it('passes through when the handler has no @RequireCedar metadata', () => {
    const guard = build(null);
    expect(guard.canActivate(fakeCtx({}))).toBe(true);
  });

  it('denies (403) when req.user is missing even if the rule would allow', () => {
    const guard = build({ action: 'deal::read', resource: 'Deal::d1' });
    expect(() => guard.canActivate(fakeCtx({ /* no user */ }))).toThrow(ForbiddenException);
  });

  it('allows an OWNER to perform a delete action by role (seed rule)', () => {
    const guard = build({ action: 'deal::delete', resource: 'Deal::d1' });
    const ctx = fakeCtx({ user: { userId: 'u1', role: 'OWNER', tenantId: 't1' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies a VIEWER from performing a write action', () => {
    const guard = build({ action: 'deal::update', resource: 'Deal::d1' });
    const ctx = fakeCtx({ user: { userId: 'u1', role: 'VIEWER', tenantId: 't1' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('derives the resource id from a function when given one', () => {
    const resolver = vi.fn((req: unknown) => `Deal::${(req as { params: { id: string } }).params.id}`);
    const guard = build({ action: 'deal::delete', resource: resolver });
    guard.canActivate(
      fakeCtx({ user: { userId: 'u1', role: 'OWNER', tenantId: 't1' }, params: { id: 'abc123' } }),
    );
    expect(resolver).toHaveBeenCalled();
  });
});
