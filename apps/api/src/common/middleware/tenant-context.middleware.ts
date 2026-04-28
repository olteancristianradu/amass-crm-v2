import { Injectable, Logger, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { loadEnv } from '../../config/env';
import { JwtPayload } from '../../modules/auth/auth.service';
import { tenantStorage } from '../../infra/prisma/tenant-context';

/**
 * Decodes the JWT (best-effort, non-blocking) and stores tenant context in
 * AsyncLocalStorage so downstream services can call `prisma.runWithTenant`.
 *
 * This is a MIDDLEWARE not a guard — it doesn't reject the *missing* token
 * case (that's `JwtAuthGuard`'s job, which now runs globally as APP_GUARD).
 *
 * **But:** if a Bearer header IS present and the token is corrupt/expired,
 * we reject HERE with 401 instead of swallowing the error silently.
 *
 * Why: pre-fix, the swallow path let requests continue with no ALS context.
 * If the route was wrapped in `JwtAuthGuard` the guard would catch it and
 * 401, but the chain `(unguarded route) + (service uses getTenantContext)`
 * would skip every multi-tenant boundary (no `runWithTenant`, no
 * `SET LOCAL ROLE app_user`) and the connection-string user (BYPASSRLS in
 * dev) would return cross-tenant data. Audit finding H2.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly env = loadEnv();
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(private readonly jwt: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return next();
    }
    const token = auth.slice('Bearer '.length).trim();

    // Heuristic: only attempt JWT verification on tokens that LOOK like a
    // JWT (`header.payload.signature` — three base64url segments). Static
    // system tokens (AI_WORKER_SECRET, SCIM tokens, etc.) are sent on
    // `Authorization: Bearer` but aren't JWTs; verifying them throws and
    // would 401 routes that should be authenticated by their own guard.
    //
    // Routes that need tenant context still rely on `JwtAuthGuard` (global,
    // post-H1) to reject missing/invalid JWTs, so skipping non-JWT tokens
    // here is safe: requireTenantContext() in services throws if there's
    // no context, and @Public() routes shouldn't be touching tenant data.
    const looksLikeJwt = token.split('.').length === 3;
    if (!looksLikeJwt) {
      return next();
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token, { secret: this.env.JWT_SECRET });
      tenantStorage.run(
        { tenantId: payload.tid, userId: payload.sub, role: payload.role },
        () => next(),
      );
    } catch (err) {
      // M-aud-H2: never let a corrupt/expired JWT through silently. Log the
      // category (without the token bytes) and short-circuit with 401 so
      // any subsequent service call cannot fall back to a no-context query
      // path that bypasses the multi-tenant guarantees.
      const reason = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`Rejected request with invalid JWT: ${reason}`);
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired authentication token',
      });
    }
  }
}
