import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Territory, TerritoryAssignment } from '@prisma/client';
import {
  CreateTerritoryDto,
  UpdateTerritoryDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class TerritoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTerritoryDto): Promise<Territory> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.territory.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          counties: dto.counties,
          industries: dto.industries,
        },
      }),
    );
  }

  async findAll(): Promise<(Territory & { assignments: TerritoryAssignment[] })[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.territory.findMany({
        where: { tenantId: ctx.tenantId },
        include: { assignments: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async findOne(id: string): Promise<Territory & { assignments: TerritoryAssignment[] }> {
    const ctx = requireTenantContext();
    const t = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.territory.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: { assignments: true },
      }),
    );
    if (!t) throw new NotFoundException({ code: 'TERRITORY_NOT_FOUND', message: 'Territory not found' });
    return t;
  }

  async update(id: string, dto: UpdateTerritoryDto): Promise<Territory> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.territory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.counties !== undefined ? { counties: dto.counties } : {}),
          ...(dto.industries !== undefined ? { industries: dto.industries } : {}),
        },
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.territory.delete({ where: { id } }),
    );
  }

  async assign(territoryId: string, userId: string): Promise<TerritoryAssignment> {
    await this.findOne(territoryId);
    const ctx = requireTenantContext();
    try {
      return await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.territoryAssignment.create({ data: { territoryId, userId } }),
      );
    } catch {
      // Unique (territory_id, user_id) violation → user already assigned.
      throw new ConflictException({ code: 'ALREADY_ASSIGNED', message: 'User already assigned to this territory' });
    }
  }

  async unassign(territoryId: string, userId: string): Promise<void> {
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.territoryAssignment.deleteMany({ where: { territoryId, userId } }),
    );
  }
}
