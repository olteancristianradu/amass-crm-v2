import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateClientDto, UpdateClientDto } from '@amass/shared';
import { Client, Prisma } from '@prisma/client';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
  ) {}

  async create(dto: CreateClientDto): Promise<Client> {
    const ctx = requireTenantContext();
    const client = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.client.create({ data: { ...dto, tenantId: ctx.tenantId, createdById: ctx.userId } }),
    );
    await this.audit.log({
      action: 'client.create',
      subjectType: 'client',
      subjectId: client.id,
      metadata: { name: `${client.firstName} ${client.lastName}` },
    });
    await this.activities.log({
      subjectType: 'CLIENT',
      subjectId: client.id,
      action: 'client.created',
      metadata: { name: `${client.firstName} ${client.lastName}` },
    });
    return client;
  }

  async list(
    cursor: string | undefined,
    limit: number,
    q: string | undefined,
  ): Promise<CursorPage<Client>> {
    const ctx = requireTenantContext();
    const where: Prisma.ClientWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.client.findMany({ where, ...buildCursorArgs(cursor, limit) }),
    );
    return makeCursorPage(items, limit);
  }

  async findOne(id: string): Promise<Client> {
    const ctx = requireTenantContext();
    const client = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.client.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!client) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND', message: 'Client not found' });
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<Client> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.client.update({ where: { id }, data: dto }),
    );
    await this.audit.log({
      action: 'client.update',
      subjectType: 'client',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    await this.activities.log({
      subjectType: 'CLIENT',
      subjectId: id,
      action: 'client.updated',
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.client.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({ action: 'client.delete', subjectType: 'client', subjectId: id });
    await this.activities.log({
      subjectType: 'CLIENT',
      subjectId: id,
      action: 'client.deleted',
    });
  }
}
