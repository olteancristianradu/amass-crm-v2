import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { loadEnv } from '../../config/env';
import { getTenantContext } from '../../infra/prisma/tenant-context';

/**
 * A-scaffold (partial real implementation): Conditional Access middleware.
 *
 * Evaluates a small, hard-coded policy set on every request. The policies
 * are intentionally minimal so this file stays a *template* — adding new
 * ones is one `if` block at a time, wired into `evaluate()`. Future
 * iterations will externalise rules into the `CedarPolicyService` or a
 * DB table keyed on `tenantId`.
 *
 * Currently enforced:
 *
 *   1. **IP allow-list for admin routes.** When
 *      `CONDITIONAL_ACCESS_ADMIN_ALLOW_IPS` is set (comma-separated list
 *      of CIDR-less IPs), any request to `/api/v1/audit*`, `/api/v1/users*`,
 *      `/api/v1/settings*`, `/api/v1/billing*` from outside the list is
 *      rejected with 403 CONDITIONAL_ACCESS_BLOCKED. Unset = disabled.
 *
 *   2. **Business-hours window for destructive admin actions.** When
 *      `CONDITIONAL_ACCESS_BUSINESS_HOURS` is set (format `HH-HH`, e.g.
 *      `08-20`), DELETE requests on admin routes outside that window are
 *      rejected. Uses server-local time. Unset = disabled.
 *
 * Both policies are opt-in. With no env vars set, the middleware is a
 * pass-through — matches the original scaffold behaviour.
 *
 * Register in `AppModule.configure()` before `TenantContextMiddleware` is
 * NOT required: this middleware only needs `req.ip` and URL, not tenant
 * context. Place it after auth so unauthenticated requests are rejected
 * earlier with 401 rather than 403 here.
 */

const ADMIN_ROUTE_PREFIXES = [
  '/api/v1/audit',
  '/api/v1/users',
  '/api/v1/settings',
  '/api/v1/billing',
];

@Injectable()
export class ConditionalAccessMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const env = loadEnv();
    const url = req.originalUrl ?? req.url ?? '';
    const isAdmin = ADMIN_ROUTE_PREFIXES.some((p) => url.startsWith(p));
    if (!isAdmin) return next();

    // Policy 1: IP allow-list
    const allowIpsRaw = env.CONDITIONAL_ACCESS_ADMIN_ALLOW_IPS;
    if (allowIpsRaw) {
      const allowList = allowIpsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      const clientIp = extractClientIp(req);
      if (allowList.length > 0 && !allowList.includes(clientIp)) {
        throw new ForbiddenException({
          code: 'CONDITIONAL_ACCESS_BLOCKED',
          reason: 'admin_ip_not_allowlisted',
          ip: clientIp,
        });
      }
    }

    // Policy 2: business-hours window for DELETE on admin routes
    const hoursRaw = env.CONDITIONAL_ACCESS_BUSINESS_HOURS;
    if (hoursRaw && req.method === 'DELETE') {
      const match = /^(\d{1,2})-(\d{1,2})$/.exec(hoursRaw);
      if (match) {
        const from = Number(match[1]);
        const to = Number(match[2]);
        const now = new Date().getHours();
        if (now < from || now >= to) {
          const ctx = getTenantContext();
          throw new ForbiddenException({
            code: 'CONDITIONAL_ACCESS_BLOCKED',
            reason: 'outside_business_hours',
            window: hoursRaw,
            tenantId: ctx?.tenantId,
          });
        }
      }
    }

    next();
  }
}

/**
 * `req.ip` already respects `app.set('trust proxy', …)` when configured,
 * but in tests and some proxy layouts it can be undefined. Fall back to
 * socket.remoteAddress and strip the IPv4-mapped-IPv6 prefix so the
 * allow-list can be written in familiar dotted-quad form.
 */
function extractClientIp(req: Request): string {
  const raw = req.ip ?? req.socket.remoteAddress ?? '';
  return raw.replace(/^::ffff:/, '');
}
