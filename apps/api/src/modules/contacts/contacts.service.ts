import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateContactDto, UpdateContactDto } from '@amass/shared';
import { Contact, Prisma } from '@prisma/client';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateContactDto): Promise<Contact> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      // If a companyId is given, ensure it belongs to the same tenant.
      // RLS would already block cross-tenant inserts, but a clean error is friendlier.
      if (dto.companyId) {
        const company = await tx.company.findFirst({
          where: { id: dto.companyId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!company) {
          throw new BadRequestException({ code: 'COMPANY_NOT_FOUND', message: 'companyId does not exist in this tenant' });
        }
      }
      const contact = await tx.contact.create({
        data: { ...dto, tenantId: ctx.tenantId, createdById: ctx.userId },
      });
      await this.audit.log({
        action: 'contact.create',
        subjectType: 'contact',
        subjectId: contact.id,
        metadata: { name: `${contact.firstName} ${contact.lastName}` },
      });
      return contact;
    });
  }

  async list(
    cursor: string | undefined,
    limit: number,
    q: string | undefined,
  ): Promise<CursorPage<Contact>> {
    const ctx = requireTenantContext();
    const where: Prisma.ContactWhereInput = {
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
      tx.contact.findMany({ where, ...buildCursorArgs(cursor, limit) }),
    );
    return makeCursorPage(items, limit);
  }

  async findOne(id: string): Promise<Contact> {
    const ctx = requireTenantContext();
    const contact = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contact.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found' });
    return contact;
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contact.update({ where: { id }, data: dto }),
    );
    await this.audit.log({
      action: 'contact.update',
      subjectType: 'contact',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contact.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({ action: 'contact.delete', subjectType: 'contact', subjectId: id });
  }
}
