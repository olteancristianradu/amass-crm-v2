import {
  ConflictException,
  Injectable,
  NotFoundException,
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
      throw new NotFoundException({ code: 'AUTH_REQUIRED', message: 'No user context' });
    }
    let view: SavedView;
    try {
      view = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.savedView.create({
          data: {
            tenantId: ctx.tenantId,
            ownerId: ctx.userId!,
            resource: dto.resource,
            name: dto.name,
            filters: dto.filters as Prisma.InputJsonValue,
          },
        }),
      );
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
      action: 'saved_view.create',
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
   */
  async findOne(id: string): Promise<SavedView> {
    const ctx = requireTenantContext();
    const view = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.savedView.findFirst({
        where: { id, tenantId: ctx.tenantId, ownerId: ctx.userId ?? '' },
      }),
    );
    if (!view) {
      throw new NotFoundException({ code: 'SAVED_VIEW_NOT_FOUND', message: 'Saved view not found' });
    }
    return view;
  }

  async update(id: string, dto: UpdateSavedViewDto): Promise<SavedView> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    let updated: SavedView;
    try {
      updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.savedView.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.filters !== undefined
              ? { filters: dto.filters as Prisma.InputJsonValue }
              : {}),
          },
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'SAVED_VIEW_NAME_TAKEN',
          message: `Another view already has this name`,
        });
      }
      throw err;
    }
    await this.audit.log({
      action: 'saved_view.update',
      subjectType: 'saved_view',
      subjectId: updated.id,
      metadata: {
        resource: updated.resource,
        // Snapshot of what changed so an investigator can replay history.
        changed: {
          name: dto.name !== undefined ? { from: existing.name, to: updated.name } : undefined,
          filtersReplaced: dto.filters !== undefined,
        },
      },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.savedView.delete({ where: { id } }),
    );
    await this.audit.log({
      action: 'saved_view.delete',
      subjectType: 'saved_view',
      subjectId: id,
      metadata: { resource: existing.resource, name: existing.name },
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
