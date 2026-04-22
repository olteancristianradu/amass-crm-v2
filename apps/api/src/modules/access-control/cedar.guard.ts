import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CedarPolicyService } from './cedar-policy.service';
import { CedarRequirement, CEDAR_METADATA_KEY } from './cedar.decorator';

/**
 * D-scaffold: route guard that consults `CedarPolicyService` before the
 * handler runs. Requires a `@RequireCedar({...})` metadata entry — absent
 * metadata is a pass-through (no-op) so adding the guard to a controller
 * or globally doesn't break every route without a decorator.
 *
 * Deny → 403 Forbidden with the evaluator's `reasons` array in the body,
 * which is useful for FE affordance (grey out a button + show tooltip
 * instead of a generic error).
 *
 * Wired on a per-route basis today. When ready for global enforcement,
 * set `{ provide: APP_GUARD, useClass: CedarGuard }` in `app.module.ts`
 * AFTER `JwtAuthGuard` so `req.user` is populated.
 */
@Injectable()
export class CedarGuard implements CanActivate {
  constructor(
    private readonly cedar: CedarPolicyService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const requirement = this.reflector.getAllAndOverride<CedarRequirement>(CEDAR_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true; // no metadata → no check

    const user = req.user;
    if (!user) {
      // JwtAuthGuard should have run first; if req.user is missing the
      // deny-by-default in CedarPolicyService would still block, but
      // returning 403 directly is clearer.
      throw new ForbiddenException({
        code: 'CEDAR_DENIED',
        reasons: ['no_authenticated_user'],
      });
    }

    const resource =
      typeof requirement.resource === 'function'
        ? requirement.resource(req)
        : requirement.resource;

    const extra = requirement.context ? requirement.context(req) : {};
    const decision = this.cedar.check({
      principal: `User::${user.userId}`,
      action: requirement.action,
      resource,
      context: { role: user.role, ...extra },
    });

    if (!decision.allow) {
      throw new ForbiddenException({ code: 'CEDAR_DENIED', reasons: decision.reasons });
    }
    return true;
  }
}
