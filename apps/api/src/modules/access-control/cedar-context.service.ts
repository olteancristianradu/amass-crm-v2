import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * CedarContextService — builder for the async `context` callback passed
 * to `@RequireCedar(...)`. Exposes Prisma access so decorators can do
 * real ownership lookups (e.g. "is req.user.userId the ownerId on this
 * Deal?") without wiring their own DB plumbing.
 *
 * Usage:
 * ```ts
 * import { CedarContextService } from '...';
 * @RequireCedar({
 *   action: 'deal::update',
 *   resource: (req) => `Deal::${(req as ReqWithId).params.id}`,
 *   context: (req) => CedarContextService.isOwnerOf(
 *     // resolved via the global singleton — see getInstance() below
 *     prisma, (req as ReqWithUser).user, 'deal', (req as ReqWithId).params.id,
 *   ),
 * })
 * ```
 *
 * NOTE: We use a static getInstance() + one-time init from AppModule
 * bootstrap because NestJS decorator metadata is evaluated at module
 * load, long before DI is ready. A singleton lookup is the cheapest
 * way to keep the decorator signature a simple function while still
 * giving it a live PrismaService.
 */
/**
 * Resource kinds that have a direct ownership/assignment column in the
 * Prisma schema. Extend this as schema evolves. Adding a kind that does
 * NOT have an ownerId/assigneeId will TS-fail loudly at the `switch`
 * below — intentional, so we don't silently return `{ isOwner: false }`.
 */
type ResourceKind = 'deal' | 'task';

@Injectable()
export class CedarContextService {
  private static instance: CedarContextService | null = null;

  constructor(private readonly prisma: PrismaService) {
    CedarContextService.instance = this;
  }

  /** Singleton accessor for @RequireCedar context callbacks. */
  static getInstance(): CedarContextService {
    if (!CedarContextService.instance) {
      throw new Error('CedarContextService not initialised — did AccessControlModule load?');
    }
    return CedarContextService.instance;
  }

  /**
   * Classical ownership check — returns `{ isOwner: boolean }` for the
   * given resource kind + id. Uses runWithTenant so RLS still applies:
   * if the resource isn't in the caller's tenant we silently return
   * false (the lookup sees no row).
   */
  async isOwnerOf(
    user: AuthenticatedUser,
    kind: ResourceKind,
    resourceId: string,
  ): Promise<{ isOwner: boolean }> {
    try {
      const ownerId = await this.prisma.runWithTenant(user.tenantId, async (tx) => {
        if (kind === 'deal') {
          const row = await tx.deal.findFirst({ where: { id: resourceId }, select: { ownerId: true } });
          return row?.ownerId ?? null;
        }
        // kind === 'task'
        const row = await tx.task.findFirst({ where: { id: resourceId }, select: { assigneeId: true } });
        return row?.assigneeId ?? null;
      });
      if (!ownerId) return { isOwner: false };
      return { isOwner: ownerId === user.userId };
    } catch {
      // Silent fail-closed — if the lookup errors, don't escalate privileges.
      return { isOwner: false };
    }
  }

  /** Shortcut for the common {@link RequireCedar} context factory. */
  static ownerOf(kind: ResourceKind, paramName = 'id') {
    return async (req: unknown): Promise<Record<string, unknown>> => {
      const r = req as Request & { user?: AuthenticatedUser; params: Record<string, string> };
      if (!r.user) return { isOwner: false };
      const id = r.params[paramName];
      if (!id) return { isOwner: false };
      return CedarContextService.getInstance().isOwnerOf(r.user, kind, id);
    };
  }
}
