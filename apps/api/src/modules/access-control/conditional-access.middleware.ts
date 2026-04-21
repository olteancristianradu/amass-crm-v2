import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * A-scaffold: Conditional Access middleware. Shape inspired by Azure AD CA:
 * when real policies land, each request gets evaluated against rules like
 * "require MFA from this IP range", "block access outside business hours",
 * "step-up auth for admin actions". For now the middleware is a pass-through
 * with a TODO anchor so route wiring can be added ahead of policy logic.
 *
 * Enable later by listing it in AppModule.configure() ahead of the tenant
 * guard. Leaving it unregistered is intentional — it's a stub.
 */
@Injectable()
export class ConditionalAccessMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    // TODO(access-control): evaluate the loaded policy set against the
    // (tenant, user, ip, device, time) tuple and call next() / throw 403.
    next();
  }
}
