import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SavedView } from '@prisma/client';
import {
  CreateSavedViewDto,
  SavedViewResource,
  UpdateSavedViewDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * Per-user list-page filter snapshots. The `filters` JSON is opaque to the
 * BE — list pages set whatever shape they want and the FE re-applies it
 * when a view is selected. This keeps adding new list pages a FE-only
 * change (just add the resource string to `SavedViewResourceSchema`).
 */
@Injectable()
export class SavedViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSavedViewDto): Promise<SavedView> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new NotFoundException({ code: 'AUTH_REQUIRED', message: 'No user context' });
    }
    try {
      return await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
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
    await this.findOne(id);
    const ctx = requireTenantContext();
    try {
      return await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
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
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.savedView.delete({ where: { id } }),
    );
  }
}
