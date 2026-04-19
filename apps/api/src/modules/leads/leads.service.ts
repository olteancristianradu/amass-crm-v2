import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Lead, Prisma } from '@prisma/client';
import {
  ConvertLeadDto,
  CreateLeadDto,
  ListLeadsQueryDto,
  UpdateLeadDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';

/**
 * LeadsService — manages top-of-funnel leads before they are converted to
 * Contact / Company / Deal records.
 *
 * Key design decisions:
 *   - `convert()` is atomic: it runs inside a single runWithTenant transaction
 *     so that partial conversion never leaves orphaned records.
 *   - After conversion, lead.status is stamped CONVERTED and lead.convertedAt
 *     is set. The IDs of created records are stored for traceability.
 *   - We do NOT use ActivitiesService here (leads are not yet a SubjectType in
 *     the polymorphic timeline). Audit log is enough for the current sprint.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateLeadDto): Promise<Lead> {
    const ctx = requireTenantContext();
    const lead = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.lead.create({
        data: {
          tenantId: ctx.tenantId,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          company: dto.company ?? null,
          jobTitle: dto.jobTitle ?? null,
          source: dto.source ?? null,
          status: dto.status ?? 'NEW',
          score: dto.score ?? 0,
          ownerId: dto.ownerId ?? null,
          notes: dto.notes ?? null,
          createdById: ctx.userId ?? null,
        },
      }),
    );
    await this.audit.log({
      action: 'lead.create',
      subjectType: 'lead',
      subjectId: lead.id,
      metadata: {
        email: lead.email,
        company: lead.company,
      },
    });
    return lead;
  }

  async findAll(q: ListLeadsQueryDto): Promise<CursorPage<Lead>> {
    const ctx = requireTenantContext();
    const where: Prisma.LeadWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.q
        ? {
            OR: [
              { firstName: { contains: q.q, mode: 'insensitive' } },
              { lastName: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { company: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.lead.findMany({ where, ...cursorArgs }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Lead> {
    const ctx = requireTenantContext();
    const lead = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.lead.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!lead) {
      throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
    }
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto): Promise<Lead> {
    // Verify existence + tenant ownership before update
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.LeadUpdateInput = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.company !== undefined ? { company: dto.company } : {}),
      ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle } : {}),
      ...(dto.source !== undefined ? { source: dto.source } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.score !== undefined ? { score: dto.score } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.lead.update({ where: { id }, data }),
    );
    await this.audit.log({
      action: 'lead.update',
      subjectType: 'lead',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * Convert a lead into CRM records atomically:
   *   1. Optionally create a Company (or link to an existing one).
   *   2. Always create a Contact from the lead data.
   *   3. Optionally create a Deal (requires pipelineId + stageId).
   *   4. Stamp the lead as CONVERTED with the IDs of created records.
   *
   * Throws LEAD_ALREADY_CONVERTED if the lead is already in CONVERTED status.
   * Throws COMPANY_NOT_FOUND if existingCompanyId is provided but not found.
   * Throws DEAL_MISSING_PIPELINE_STAGE if createDeal=true but IDs are absent.
   */
  async convert(
    id: string,
    dto: ConvertLeadDto,
  ): Promise<{ lead: Lead; contactId: string; companyId: string | null; dealId: string | null }> {
    const existing = await this.findOne(id);
    if (existing.status === 'CONVERTED') {
      throw new BadRequestException({
        code: 'LEAD_ALREADY_CONVERTED',
        message: 'This lead has already been converted',
      });
    }
    if (dto.createDeal && (!dto.dealPipelineId || !dto.dealStageId)) {
      throw new BadRequestException({
        code: 'DEAL_MISSING_PIPELINE_STAGE',
        message: 'dealPipelineId and dealStageId are required when createDeal is true',
      });
    }

    const ctx = requireTenantContext();

    const result = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      // 1. Resolve or create company
      let resolvedCompanyId: string | null = null;
      if (dto.existingCompanyId) {
        const co = await tx.company.findFirst({
          where: { id: dto.existingCompanyId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!co) {
          throw new BadRequestException({
            code: 'COMPANY_NOT_FOUND',
            message: 'existingCompanyId does not exist in this tenant',
          });
        }
        resolvedCompanyId = co.id;
      } else if (dto.createCompany) {
        const name = dto.companyName ?? existing.company ?? 'Unknown Company';
        const co = await tx.company.create({
          data: {
            tenantId: ctx.tenantId,
            name,
            createdById: ctx.userId ?? null,
          },
        });
        resolvedCompanyId = co.id;
      }

      // 2. Create contact from lead fields
      const contact = await tx.contact.create({
        data: {
          tenantId: ctx.tenantId,
          firstName: existing.firstName ?? '',
          lastName: existing.lastName ?? '',
          email: existing.email ?? null,
          phone: existing.phone ?? null,
          jobTitle: existing.jobTitle ?? null,
          companyId: resolvedCompanyId,
          createdById: ctx.userId ?? null,
        },
      });

      // 3. Optionally create deal
      let resolvedDealId: string | null = null;
      if (dto.createDeal && dto.dealPipelineId && dto.dealStageId) {
        // Verify stage belongs to tenant and pipeline (RLS also protects this)
        const stage = await tx.pipelineStage.findFirst({
          where: {
            id: dto.dealStageId,
            pipelineId: dto.dealPipelineId,
            tenantId: ctx.tenantId,
            deletedAt: null,
          },
          select: { type: true },
        });
        if (!stage) {
          throw new BadRequestException({
            code: 'STAGE_NOT_FOUND',
            message: 'dealStageId does not exist in the given pipeline for this tenant',
          });
        }
        // Compute status from stage type (mirrors DealsService pattern)
        const statusMap: Record<string, 'OPEN' | 'WON' | 'LOST'> = {
          OPEN: 'OPEN',
          WON: 'WON',
          LOST: 'LOST',
        };
        const dealStatus = statusMap[stage.type] ?? 'OPEN';

        const deal = await tx.deal.create({
          data: {
            tenantId: ctx.tenantId,
            pipelineId: dto.dealPipelineId,
            stageId: dto.dealStageId,
            title: dto.dealTitle ?? `Lead: ${existing.firstName ?? ''} ${existing.lastName ?? ''}`.trim(),
            value: dto.dealValue !== undefined ? new Prisma.Decimal(dto.dealValue) : null,
            currency: 'RON',
            status: dealStatus,
            companyId: resolvedCompanyId,
            contactId: contact.id,
            ownerId: existing.ownerId,
            createdById: ctx.userId ?? null,
            orderInStage: 10,
          },
        });
        resolvedDealId = deal.id;
      }

      // 4. Stamp lead as converted
      const convertedLead = await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedToContactId: contact.id,
          convertedToCompanyId: resolvedCompanyId,
          convertedToDealId: resolvedDealId,
        },
      });

      return {
        lead: convertedLead,
        contactId: contact.id,
        companyId: resolvedCompanyId,
        dealId: resolvedDealId,
      };
    });

    await this.audit.log({
      action: 'lead.convert',
      subjectType: 'lead',
      subjectId: id,
      metadata: {
        contactId: result.contactId,
        companyId: result.companyId,
        dealId: result.dealId,
      },
    });
    return result;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.lead.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'lead.delete',
      subjectType: 'lead',
      subjectId: id,
      metadata: { email: existing.email, company: existing.company },
    });
  }
}
