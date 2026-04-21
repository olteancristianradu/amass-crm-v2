import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getTenantContext } from '../../infra/prisma/tenant-context';

/**
 * B-scaling: per-tenant rate limiting. The stock ThrottlerGuard keys by IP
 * which is useless in a multi-tenant world — one noisy tenant shouldn't be
 * able to starve others, but co-located employees behind one NAT shouldn't
 * share a counter either.
 *
 * Tracker precedence:
 *   1. tenantId + userId   → authed requests (main case)
 *   2. tenantId            → pre-auth tenant-scoped (slug lookups)
 *   3. IP                  → unauthenticated (login, public portal)
 *
 * Falls back gracefully so global limits still apply on login flows.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ctx = getTenantContext();
    if (ctx?.tenantId && ctx.userId) {
      return `t:${ctx.tenantId}:u:${ctx.userId}`;
    }
    if (ctx?.tenantId) {
      return `t:${ctx.tenantId}`;
    }
    // Fall back to upstream behaviour for unauthenticated requests.
    return super.getTracker(req);
  }
}
