import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityTag, Tag } from '@prisma/client';
import { AssignTagDto, CreateTagDto, ListTagsQueryDto, UpdateTagDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export type TagWithCount = Tag & { _count: { entityTags: number } };

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTagDto): Promise<Tag> {
    const { tenantId } = requireTenantContext();
    try {
      return await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.tag.create({ data: { tenantId, name: dto.name, color: dto.color ?? null } }),
      );
    } catch {
      throw new ConflictException({ code: 'TAG_EXISTS', message: `Tag "${dto.name}" already exists` });
    }
  }

  async list(query: ListTagsQueryDto): Promise<TagWithCount[]> {
    const { tenantId } = requireTenantContext();

    if (query.entityId && query.entityType) {
      // Return only tags attached to this entity
      const entityTags = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.entityTag.findMany({
          where: { tenantId, entityId: query.entityId, entityType: query.entityType },
          include: { tag: { include: { _count: { select: { entityTags: true } } } } },
        }),
      );
      return entityTags.map((et) => et.tag);
    }

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.tag.findMany({
        where: {
          tenantId,
          ...(query.entityType
            ? { entityTags: { some: { entityType: query.entityType } } }
            : {}),
        },
        include: { _count: { select: { entityTags: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async update(id: string, dto: UpdateTagDto): Promise<Tag> {
    const { tenantId } = requireTenantContext();
    await this.assertTag(tenantId, id);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.tag.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      }),
    );
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.assertTag(tenantId, id);
    // Cascade in DB removes EntityTag rows automatically
    await this.prisma.runWithTenant(tenantId, (tx) => tx.tag.delete({ where: { id } }));
  }

  async assign(tagId: string, dto: AssignTagDto): Promise<EntityTag> {
    const { tenantId } = requireTenantContext();
    await this.assertTag(tenantId, tagId);
    try {
      return await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.entityTag.create({
          data: { tenantId, tagId, entityType: dto.entityType, entityId: dto.entityId },
        }),
      );
    } catch {
      throw new ConflictException({ code: 'TAG_ALREADY_ASSIGNED', message: 'Tag already assigned to this entity' });
    }
  }

  async unassign(tagId: string, entityId: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.entityTag.deleteMany({ where: { tenantId, tagId, entityId } }),
    );
  }

  /** Returns tags indexed by entityId for a batch of entities of the same type. */
  async getTagsForEntities(entityType: string, entityIds: string[]): Promise<Map<string, Tag[]>> {
    if (entityIds.length === 0) return new Map();
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.entityTag.findMany({
        where: { tenantId, entityType, entityId: { in: entityIds } },
        include: { tag: true },
      }),
    );
    const map = new Map<string, Tag[]>();
    for (const row of rows) {
      const list = map.get(row.entityId) ?? [];
      list.push(row.tag);
      map.set(row.entityId, list);
    }
    return map;
  }

  private async assertTag(tenantId: string, id: string): Promise<Tag> {
    const tag = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.tag.findFirst({ where: { id, tenantId } }),
    );
    if (!tag) throw new NotFoundException({ code: 'TAG_NOT_FOUND', message: 'Tag not found' });
    return tag;
  }
}
