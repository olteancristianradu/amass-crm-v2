import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, SavedView } from '@prisma/client';
import {
  CreateSavedViewDto,
  SavedViewResource,
  SystemDefaultView,
  UpdateSavedViewDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';

/**
 * Per-user list-page filter snapshots. The `filters` JSON is opaque to the
 * BE — list pages set whatever shape they want and the FE re-applies it
 * when a view is selected. This keeps adding new list pages a FE-only
 * change (just add the resource string to `SavedViewResourceSchema`).
 *
 * Threat-model coverage (see docs/threat-models/phase-0.md §Feature 3):
 *   T-SV-S-01 mass-assignment    → DTO is whitelisted; ownerId/tenantId
 *                                  come from the JWT context, never from
 *                                  the request body.
 *   T-SV-I-01 IDOR               → findFirst always filters by ownerId,
 *                                  and update/remove go through findOne
 *                                  first to surface NotFound (404, never
 *                                  403 — that distinction would leak
 *                                  existence of the row to another tenant).
 *   T-SV-I-02 user tenantId      → tenantExtension auto-injects tenantId
 *                                  inside runWithTenant; even if the DTO
 *                                  carried one it would be discarded.
 *   T-SV-T-02 prototype pollution → blocked at the Zod boundary
 *                                  (FiltersSchema in shared/saved-view.ts).
 *   T-SV-I-03 stored XSS         → name regex in shared schema.
 *   T-SV-R-01 repudiation        → audit.log emitted for every mutation.
 */
/** T-SV-D-01 — per (owner, resource) cap. 50 covers every real workflow we've
 * observed; 51st returns 409 so the FE can prompt the user to delete an old
 * view. Keeps the dropdown render bounded and prevents a runaway script from
 * burying the user's UI under their own filter snapshots. */
const MAX_SAVED_VIEWS_PER_OWNER_RESOURCE = 50;

@Injectable()
export class SavedViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSavedViewDto): Promise<SavedView> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      // 401 from the controller layer is the right shape, but if a future
      // caller bypasses JwtAuthGuard we still want a hard stop.
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'No user context' });
    }
    let view: SavedView;
    try {
      view = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
        // I-3 cap check — same transaction so a concurrent burst can't slip
        // a 51st row past the limit (count + create both see the same
        // snapshot at REPEATABLE READ isolation).
        const existingCount = await tx.savedView.count({
          where: { tenantId: ctx.tenantId, ownerId: ctx.userId!, resource: dto.resource },
        });
        if (existingCount >= MAX_SAVED_VIEWS_PER_OWNER_RESOURCE) {
          throw new ConflictException({
            code: 'SAVED_VIEW_LIMIT_REACHED',
            message: `You have reached the limit of ${MAX_SAVED_VIEWS_PER_OWNER_RESOURCE} saved views for ${dto.resource}. Delete an existing view to create a new one.`,
          });
        }
        return tx.savedView.create({
          data: {
            tenantId: ctx.tenantId,
            ownerId: ctx.userId!,
            resource: dto.resource,
            name: dto.name,
            filters: dto.filters as Prisma.InputJsonValue,
          },
        });
      });
    } catch (err) {
      // P2002 = unique violation on (ownerId, resource, name) — surface
      // a friendly 409 so the FE can prompt for a different name.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'SAVED_VIEW_NAME_TAKEN',
          message: `You already have a saved view named "${dto.name}" for ${dto.resource}`,
        });
      }
      throw err;
    }
    // Audit AFTER the row is persisted — if audit fails (best-effort,
    // never throws) we don't roll back the saved view itself.
    await this.audit.log({
      action: 'savedview.created',
      subjectType: 'saved_view',
      subjectId: view.id,
      metadata: { resource: view.resource, name: view.name },
    });
    return view;
  }

  async list(resource: SavedViewResource): Promise<SavedView[]> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      return [];
    }
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.savedView.findMany({
        where: {
          tenantId: ctx.tenantId,
          ownerId: ctx.userId!,
          resource,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  /**
   * Owner-scoped fetch. Returns 404 for both "doesn't exist" and "exists
   * but belongs to someone else" so a probe can't distinguish the two
   * (T-SV-T-03 timing side-channel — same code path, same query).
   *
   * N-5 defence-in-depth: if `ctx.userId` is somehow missing (a future
   * caller that bypasses JwtAuthGuard), throw 401 BEFORE the query rather
   * than letting `ownerId: ''` silently match nothing — a 404 in that case
   * would be misleading.
   */
  async findOne(id: string): Promise<SavedView> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'No user context' });
    }
    const view = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.savedView.findFirst({
        where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId },
      }),
    );
    if (!view) {
      throw new NotFoundException({ code: 'SAVED_VIEW_NOT_FOUND', message: 'Saved view not found' });
    }
    return view;
  }

  /**
   * HIGH-2 fix — single-query, scoped UPDATE that closes the TOCTOU window
   * between findOne() and update(). The previous shape:
   *
   *   const existing = await findOne(id);  // tx-1: SELECT
   *   tx.savedView.update({ where: { id } }); // tx-2: UPDATE by PK only
   *
   * gave an attacker a slice (microseconds, but real) where ownership had
   * been checked but the UPDATE was still keyed by id alone. A concurrent
   * delete-then-recreate-by-someone-else race could land in the wrong row.
   *
   * The new shape uses `updateMany({ where: { id, tenantId, ownerId }})` —
   * scoped predicate in the same statement that mutates, so either the row
   * matches (count=1) and we're guaranteed it's ours, or it doesn't (count=0)
   * and we surface 404 identical to the cross-tenant case (T-SV-T-03).
   * `updateMany` returns count only, so we still read the row back at the
   * end for the response body + audit metadata. The second read is also
   * scoped, so a window-of-the-window swap is impossible.
   */
  async update(id: string, dto: UpdateSavedViewDto): Promise<SavedView> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'No user context' });
    }
    try {
      return await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
        // Capture "before" inside the tx so audit metadata reflects the
        // exact row we're about to mutate (and inherits tenant + owner
        // filtering from tenantExtension + the explicit where).
        const before = await tx.savedView.findFirst({
          where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId },
        });
        if (!before) {
          throw new NotFoundException({ code: 'SAVED_VIEW_NOT_FOUND', message: 'Saved view not found' });
        }
        const result = await tx.savedView.updateMany({
          where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.filters !== undefined
              ? { filters: dto.filters as Prisma.InputJsonValue }
              : {}),
          },
        });
        if (result.count !== 1) {
          // The row went away between the SELECT and the UPDATE (concurrent
          // delete). Surface as 404 — semantically the user's row no longer
          // exists by the time we tried to mutate it.
          throw new NotFoundException({ code: 'SAVED_VIEW_NOT_FOUND', message: 'Saved view not found' });
        }
        const updated = await tx.savedView.findFirstOrThrow({
          where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId },
        });
        await this.audit.log({
          action: 'savedview.updated',
          subjectType: 'saved_view',
          subjectId: updated.id,
          metadata: {
            resource: updated.resource,
            changed: {
              name: dto.name !== undefined ? { from: before.name, to: updated.name } : undefined,
              filtersReplaced: dto.filters !== undefined,
            },
          },
        });
        return updated;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'SAVED_VIEW_NAME_TAKEN',
          message: `Another view already has this name`,
        });
      }
      throw err;
    }
  }

  /**
   * HIGH-2 mirror of update() — scoped `deleteMany` instead of the 2-query
   * findOne+delete pattern that previously left a TOCTOU window.
   */
  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'No user context' });
    }
    await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      // Read first (inside the tx) so we can put resource + name into the
      // audit row — the deleteMany return shape is just `{ count }`.
      const before = await tx.savedView.findFirst({
        where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId },
      });
      if (!before) {
        throw new NotFoundException({ code: 'SAVED_VIEW_NOT_FOUND', message: 'Saved view not found' });
      }
      const result = await tx.savedView.deleteMany({
        where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId },
      });
      if (result.count !== 1) {
        throw new NotFoundException({ code: 'SAVED_VIEW_NOT_FOUND', message: 'Saved view not found' });
      }
      await this.audit.log({
        action: 'savedview.deleted',
        subjectType: 'saved_view',
        subjectId: id,
        metadata: { resource: before.resource, name: before.name },
      });
    });
  }

  /**
   * System default views — read-only, hardcoded, not persisted. Phase 0
   * ships defaults for `deals` only (FE pivot is built around the pipeline).
   * Other resources return [] today; the FE provides its own client-side
   * fallbacks until product decides which defaults to ship server-side.
   *
   * Returned `nameKey` is an i18n key — the FE picks the localized label.
   */
  getSystemDefaults(resource: SavedViewResource): SystemDefaultView[] {
    const defaults: Record<SavedViewResource, SystemDefaultView[]> = {
      deals: [
        {
          id: 'system:deals:all-mine',
          resource: 'deals',
          nameKey: 'savedViews.defaults.deals.allMine',
          filters: { ownerScope: 'me' },
        },
        {
          id: 'system:deals:won-this-month',
          resource: 'deals',
          nameKey: 'savedViews.defaults.deals.wonThisMonth',
          filters: { status: 'WON', closedAtRelative: 'this_month' },
        },
        {
          id: 'system:deals:lost-last-30d',
          resource: 'deals',
          nameKey: 'savedViews.defaults.deals.lostLast30d',
          filters: { status: 'LOST', closedAtRelative: 'last_30_days' },
        },
      ],
      companies: [],
      contacts: [],
      clients: [],
      leads: [],
      cases: [],
      invoices: [],
      quotes: [],
    };
    return defaults[resource];
  }
}
