import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCompanyDto, UpdateCompanyDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { Company, Prisma } from '@prisma/client';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
  ) {}

  async create(dto: CreateCompanyDto): Promise<Company> {
    const ctx = requireTenantContext();
    const company = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.company.create({
        data: { ...dto, tenantId: ctx.tenantId, createdById: ctx.userId },
      }),
    );
    await this.audit.log({
      action: 'company.create',
      subjectType: 'company',
      subjectId: company.id,
      metadata: { name: company.name },
    });
    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: company.id,
      action: 'company.created',
      metadata: { name: company.name },
    });
    return company;
  }

  async list(
    cursor: string | undefined,
    limit: number,
    q: string | undefined,
  ): Promise<CursorPage<Company>> {
    const ctx = requireTenantContext();
    const where: Prisma.CompanyWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { vatNumber: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.company.findMany({ where, ...buildCursorArgs(cursor, limit) }),
    );
    return makeCursorPage(items, limit);
  }

  async findOne(id: string): Promise<Company> {
    const ctx = requireTenantContext();
    const company = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.company.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found' });
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    await this.findOne(id); // existence + tenant check
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.company.update({ where: { id }, data: dto }),
    );
    await this.audit.log({
      action: 'company.update',
      subjectType: 'company',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: id,
      action: 'company.updated',
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.company.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({ action: 'company.delete', subjectType: 'company', subjectId: id });
    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: id,
      action: 'company.deleted',
    });
  }
}
