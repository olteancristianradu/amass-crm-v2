import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportEntityType } from '@prisma/client';
import { CreateReportTemplateDto, UpdateReportTemplateDto, ReportConfig, ReportFilter } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

// Columns allowed per entity to prevent injection via config.columns
const ALLOWED_COLUMNS: Record<ReportEntityType, Set<string>> = {
  DEAL: new Set(['id', 'title', 'value', 'currency', 'status', 'closedAt', 'createdAt', 'updatedAt']),
  COMPANY: new Set(['id', 'name', 'vatNumber', 'city', 'country', 'createdAt', 'updatedAt']),
  CONTACT: new Set(['id', 'firstName', 'lastName', 'email', 'phone', 'createdAt', 'updatedAt']),
  CLIENT: new Set(['id', 'name', 'email', 'phone', 'createdAt', 'updatedAt']),
  INVOICE: new Set(['id', 'number', 'total', 'currency', 'status', 'dueDate', 'issuedAt', 'createdAt']),
  QUOTE: new Set(['id', 'number', 'total', 'currency', 'status', 'validUntil', 'createdAt']),
  CALL: new Set(['id', 'direction', 'duration', 'status', 'startedAt', 'endedAt', 'createdAt']),
  ACTIVITY: new Set(['id', 'type', 'summary', 'subjectType', 'subjectId', 'createdAt']),
};

// Map entity type to Prisma delegate accessor key
const ENTITY_TABLE: Record<ReportEntityType, string> = {
  DEAL: 'deal',
  COMPANY: 'company',
  CONTACT: 'contact',
  CLIENT: 'client',
  INVOICE: 'invoice',
  QUOTE: 'quote',
  CALL: 'call',
  ACTIVITY: 'activity',
};

@Injectable()
export class ReportBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async createTemplate(dto: CreateReportTemplateDto) {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reportTemplate.create({
        data: {
          tenantId,
          createdById: userId ?? null,
          name: dto.name,
          description: dto.description ?? null,
          entityType: dto.entityType as ReportEntityType,
          config: dto.config as unknown as Prisma.JsonObject,
          isShared: dto.isShared ?? false,
        },
      }),
    );
  }

  async listTemplates() {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reportTemplate.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [{ isShared: true }, { createdById: userId ?? undefined }],
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  async getTemplate(id: string) {
    const { tenantId } = requireTenantContext();
    const tpl = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reportTemplate.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!tpl) throw new NotFoundException('Report template not found');
    return tpl;
  }

  async updateTemplate(id: string, dto: UpdateReportTemplateDto) {
    const { tenantId, userId } = requireTenantContext();
    const tpl = await this.getTemplate(id);
    if (!tpl.isShared && tpl.createdById !== userId) throw new ForbiddenException('Not your template');
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reportTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.config !== undefined ? { config: dto.config as unknown as Prisma.JsonObject } : {}),
          ...(dto.isShared !== undefined ? { isShared: dto.isShared } : {}),
        },
      }),
    );
  }

  async deleteTemplate(id: string) {
    const { tenantId } = requireTenantContext();
    await this.getTemplate(id);
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reportTemplate.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  async runTemplate(id: string): Promise<unknown[]> {
    const tpl = await this.getTemplate(id);
    const config = tpl.config as unknown as ReportConfig;
    return this.executeQuery(tpl.entityType, config);
  }

  private async executeQuery(entityType: ReportEntityType, config: ReportConfig): Promise<unknown[]> {
    const { tenantId } = requireTenantContext();
    const allowed = ALLOWED_COLUMNS[entityType];

    // Validate columns to prevent injection
    for (const col of config.columns) {
      if (!allowed.has(col)) throw new BadRequestException(`Column '${col}' not allowed for ${entityType}`);
    }

    const select = Object.fromEntries(config.columns.map((c) => [c, true]));
    const where = this.buildWhere(config.filters, allowed, tenantId);
    const delegate = (this.prisma as unknown as Record<string, unknown>)[ENTITY_TABLE[entityType]] as {
      findMany: (args: unknown) => Promise<unknown[]>;
    };

    const orderField = config.orderBy && allowed.has(config.orderBy) ? config.orderBy : 'createdAt';
    const results = await delegate.findMany({
      where,
      select: { ...select, tenantId: false },
      orderBy: { [orderField]: config.orderDir ?? 'desc' },
      take: config.limit ?? 100,
    });

    if (!config.groupBy || !allowed.has(config.groupBy)) return results as unknown[];

    // Client-side groupBy aggregation when Prisma groupBy doesn't fit the dynamic pattern
    const grouped: Record<string, unknown[]> = {};
    for (const row of results as Record<string, unknown>[]) {
      const key = String(row[config.groupBy] ?? 'null');
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    return Object.entries(grouped).map(([key, rows]) => ({ [config.groupBy!]: key, count: rows.length, rows }));
  }

  private buildWhere(filters: ReportFilter[], allowed: Set<string>, tenantId: string): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId };

    for (const f of filters) {
      if (!allowed.has(f.field)) continue; // skip unknown fields silently

      switch (f.op) {
        case 'eq': where[f.field] = f.value; break;
        case 'neq': where[f.field] = { not: f.value }; break;
        case 'gt': where[f.field] = { gt: f.value }; break;
        case 'gte': where[f.field] = { gte: f.value }; break;
        case 'lt': where[f.field] = { lt: f.value }; break;
        case 'lte': where[f.field] = { lte: f.value }; break;
        case 'contains': where[f.field] = { contains: f.value, mode: 'insensitive' }; break;
        case 'startsWith': where[f.field] = { startsWith: f.value, mode: 'insensitive' }; break;
        case 'in': where[f.field] = { in: Array.isArray(f.value) ? f.value : [f.value] }; break;
        case 'isNull': where[f.field] = null; break;
        case 'isNotNull': where[f.field] = { not: null }; break;
      }
    }

    return where;
  }
}
