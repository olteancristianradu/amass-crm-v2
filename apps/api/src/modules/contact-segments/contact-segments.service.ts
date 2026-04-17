import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateContactSegmentDto, FilterGroup, UpdateContactSegmentDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/** Map a FilterGroup to a Prisma ContactWhereInput. Supports one level of nesting. */
function buildWhere(tenantId: string, filter: FilterGroup): Prisma.ContactWhereInput {
  const conditions: Prisma.ContactWhereInput[] = filter.rules.map((rule) => {
    if ('op' in rule) {
      return buildWhere(tenantId, rule as FilterGroup);
    }
    const { field, operator, value } = rule;
    switch (operator) {
      case 'eq':         return { [field]: { equals: value } };
      case 'neq':        return { [field]: { not: value } };
      case 'contains':   return { [field]: { contains: String(value ?? ''), mode: 'insensitive' } };
      case 'not_contains': return { NOT: { [field]: { contains: String(value ?? ''), mode: 'insensitive' } } };
      case 'starts_with': return { [field]: { startsWith: String(value ?? ''), mode: 'insensitive' } };
      case 'is_empty':   return { OR: [{ [field]: null }, { [field]: '' }] };
      case 'is_not_empty': return { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: '' } }] };
      case 'is_true':    return { [field]: true };
      case 'is_false':   return { [field]: false };
      case 'gt':         return { [field]: { gt: value } };
      case 'lt':         return { [field]: { lt: value } };
      case 'gte':        return { [field]: { gte: value } };
      case 'lte':        return { [field]: { lte: value } };
      default:           return {};
    }
  });

  return filter.op === 'AND' ? { AND: conditions } : { OR: conditions };
}

@Injectable()
export class ContactSegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContactSegmentDto) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contactSegment.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          filterJson: dto.filterJson as unknown as Prisma.InputJsonValue,
          createdById: ctx.userId ?? null,
        },
      }),
    );
  }

  async list() {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contactSegment.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async findOne(id: string) {
    const ctx = requireTenantContext();
    const seg = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contactSegment.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!seg) throw new NotFoundException({ code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' });
    return seg;
  }

  async update(id: string, dto: UpdateContactSegmentDto) {
    const ctx = requireTenantContext();
    await this.findOne(id);
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contactSegment.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.filterJson ? { filterJson: dto.filterJson as unknown as Prisma.InputJsonValue } : {}),
        },
      }),
    );
  }

  async remove(id: string) {
    const ctx = requireTenantContext();
    await this.findOne(id);
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contactSegment.delete({ where: { id } }),
    );
  }

  /** Execute the segment filter and return matching contacts. */
  async preview(id: string, limit = 50) {
    const ctx = requireTenantContext();
    const seg = await this.findOne(id);
    const filter = seg.filterJson as unknown as FilterGroup;
    const where = buildWhere(ctx.tenantId, filter);

    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contact.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null, ...where },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, firstName: true, lastName: true,
          email: true, phone: true, jobTitle: true, isDecider: true,
          companyId: true,
        },
      }),
    );
  }
}
