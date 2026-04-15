import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { CursorPage, makeCursorPage } from '../../common/pagination';

/**
 * S23 ProjectsService. A project is a delivery umbrella created from a won
 * Deal (or ad-hoc) that groups invoices, tasks, attachments. The `dealId`
 * column is unique — one project per deal, max.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
  ) {}

  async create(dto: CreateProjectDto): Promise<Project> {
    const ctx = requireTenantContext();
    try {
      const project = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.project.create({
          data: {
            tenantId: ctx.tenantId,
            companyId: dto.companyId,
            dealId: dto.dealId ?? null,
            name: dto.name,
            description: dto.description ?? null,
            status: dto.status,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
            budget: dto.budget !== undefined ? new Prisma.Decimal(dto.budget) : null,
            currency: dto.currency,
            createdById: ctx.userId ?? null,
          },
        }),
      );

      await this.audit.log({
        action: 'project.create',
        subjectType: 'project',
        subjectId: project.id,
        metadata: { name: project.name, companyId: project.companyId },
      });
      await this.activities.log({
        subjectType: 'COMPANY',
        subjectId: project.companyId,
        action: 'project.created',
        metadata: { projectId: project.id, name: project.name },
      });
      return project;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'PROJECT_DEAL_TAKEN',
          message: 'A project already exists for this deal',
        });
      }
      throw err;
    }
  }

  async list(q: ListProjectsQueryDto): Promise<CursorPage<Project>> {
    const ctx = requireTenantContext();
    const where: Prisma.ProjectWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.project.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Project> {
    const ctx = requireTenantContext();
    const project = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.project.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!project) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    return project;
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    await this.findOne(id);
    const ctx = requireTenantContext();

    const data: Prisma.ProjectUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.budget !== undefined
        ? { budget: dto.budget === null ? null : new Prisma.Decimal(dto.budget) }
        : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
    };

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.project.update({ where: { id }, data }),
    );
    await this.audit.log({
      action: 'project.update',
      subjectType: 'project',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.project.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'project.delete',
      subjectType: 'project',
      subjectId: id,
      metadata: { name: existing.name },
    });
  }

  /**
   * Create a project from a won deal. Called by WorkflowsService when a
   * DEAL_STAGE_CHANGED event lands with a WON stage. Idempotent — if a
   * project already exists for the deal, returns the existing one.
   */
  async createFromDeal(dealId: string): Promise<Project | null> {
    const ctx = requireTenantContext();
    const existing = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.project.findUnique({ where: { dealId } }),
    );
    if (existing) return existing;

    const deal = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.findFirst({ where: { id: dealId, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!deal || !deal.companyId) return null;

    return this.create({
      companyId: deal.companyId,
      dealId: deal.id,
      name: deal.title,
      status: 'PLANNED',
      currency: (deal.currency as 'RON' | 'EUR' | 'USD') ?? 'RON',
      budget: deal.value ? deal.value.toFixed(2) : undefined,
    });
  }
}
