import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCompanyDto, UpdateCompanyDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { EmbeddingService } from '../ai/embedding.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { Company, Prisma } from '@prisma/client';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly embedding: EmbeddingService,
    private readonly workflows: WorkflowsService,
    private readonly webhooks: WebhooksService,
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
    void this.embedding.updateCompany(
      company.id,
      [company.name, company.industry, company.city, company.notes].filter(Boolean).join(' '),
    );
    void this.workflows.trigger({
      trigger: 'COMPANY_CREATED',
      subjectType: 'COMPANY',
      subjectId: company.id,
      tenantId: ctx.tenantId,
    });
    // Outbound webhook dispatch — fire-and-forget; failures land in
    // webhook_deliveries with success=false and the operator can retry
    // via the dashboard. Wired here (not in the controller) so internal
    // callers also fire the event when they create a company.
    this.webhooks.dispatch(ctx.tenantId, 'COMPANY_CREATED', { id: company.id, name: company.name });
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

  /** List direct subsidiaries (children where parentId = :id). */
  async subsidiaries(id: string): Promise<Company[]> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.company.findMany({
        where: { parentId: id, tenantId: ctx.tenantId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
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
    void this.embedding.updateCompany(
      updated.id,
      [updated.name, updated.industry, updated.city, updated.notes].filter(Boolean).join(' '),
    );
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

  /**
   * Faza-D: soft-delete N companies in a single transaction. Returns the
   * count actually deleted (caller may have asked for ids that don't
   * belong to this tenant — RLS filters those out silently).
   *
   * One audit row + one activity row per company so the operator can
   * still see in the timeline what was deleted.
   */
  async bulkDelete(ids: string[]): Promise<{ deleted: number; skipped: string[] }> {
    if (ids.length === 0) return { deleted: 0, skipped: [] };
    const ctx = requireTenantContext();
    // Single transaction: find which ids belong to this tenant + are
    // not already deleted, then update them all in one go. Anything
    // that's missing or cross-tenant gets reported back as `skipped`.
    const result = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const live = await tx.company.findMany({
        where: { id: { in: ids }, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      const liveIds = live.map((c) => c.id);
      if (liveIds.length === 0) return { deleted: 0, liveIds, skipped: ids };
      await tx.company.updateMany({
        where: { id: { in: liveIds }, tenantId: ctx.tenantId },
        data: { deletedAt: new Date() },
      });
      const skipped = ids.filter((id) => !liveIds.includes(id));
      return { deleted: liveIds.length, liveIds, skipped };
    });

    // Audit + activity rows AFTER the tx so a failed write here doesn't
    // roll back the user-visible delete (audit is best-effort sidecar).
    await Promise.all(result.liveIds.map((id) => Promise.all([
      this.audit.log({ action: 'company.delete', subjectType: 'company', subjectId: id }),
      this.activities.log({
        subjectType: 'COMPANY',
        subjectId: id,
        action: 'company.deleted',
        metadata: { bulk: true, batchSize: result.liveIds.length },
      }),
    ])));

    return { deleted: result.deleted, skipped: result.skipped };
  }
}
