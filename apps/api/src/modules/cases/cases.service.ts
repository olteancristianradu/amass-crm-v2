import { Injectable, NotFoundException } from '@nestjs/common';
import { Case, CasePriority, Prisma } from '@prisma/client';
import {
  CreateCaseDto,
  ListCasesQueryDto,
  UpdateCaseDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCaseDto): Promise<Case> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      // Race fix (same pattern as orders.service.ts): pg_advisory_xact_lock
      // serialises concurrent number assignments per tenant. Without it,
      // two concurrent create() calls hit the (tenant_id, number) unique
      // constraint with a P2002 collision. The lock auto-releases on
      // commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cases:nextNumber:${ctx.tenantId}`}))`;
      const last = await tx.case.findFirst({
        where: { tenantId: ctx.tenantId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;
      return tx.case.create({
        data: {
          tenantId: ctx.tenantId,
          number,
          subject: dto.subject,
          description: dto.description ?? null,
          priority: dto.priority,
          companyId: dto.companyId ?? null,
          contactId: dto.contactId ?? null,
          assigneeId: dto.assigneeId ?? null,
          slaDeadline: dto.slaDeadline ?? null,
          createdById: ctx.userId ?? null,
        },
      });
    });
  }

  async findAll(q: ListCasesQueryDto): Promise<CursorPage<Case>> {
    const ctx = requireTenantContext();
    const where: Prisma.CaseWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.case.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Case> {
    const ctx = requireTenantContext();
    const c = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.case.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!c) {
      throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Case not found' });
    }
    return c;
  }

  async update(id: string, dto: UpdateCaseDto): Promise<Case> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    // When transitioning into a terminal state, stamp resolvedAt automatically.
    const reachingTerminal =
      dto.status &&
      (dto.status === 'RESOLVED' || dto.status === 'CLOSED') &&
      existing.status !== 'RESOLVED' &&
      existing.status !== 'CLOSED';
    const data: Prisma.CaseUpdateInput = {
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.companyId !== undefined ? { companyId: dto.companyId } : {}),
      ...(dto.contactId !== undefined ? { contactId: dto.contactId } : {}),
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
      ...(dto.slaDeadline !== undefined ? { slaDeadline: dto.slaDeadline } : {}),
      ...(dto.resolution !== undefined ? { resolution: dto.resolution } : {}),
      ...(reachingTerminal ? { resolvedAt: new Date() } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.case.update({ where: { id }, data }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.case.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  /**
   * SLA escalation sweep across ALL tenants. Promotes priority on any
   * still-open case whose slaDeadline has passed: NORMAL→HIGH, HIGH→URGENT.
   * Idempotent — already-URGENT cases don't move.
   */
  async escalateOverdueForAllTenants(): Promise<number> {
    const now = new Date();
    // Cross-tenant sweep: intentionally does NOT call runWithTenant so the cron
    // can see every tenant's overdue cases. Safe because the query only touches
    // the `cases` table and only bumps priority; no PII is read or leaked.
    const candidates = await this.prisma.case.findMany({
      where: {
        deletedAt: null,
        resolvedAt: null,
        slaDeadline: { lt: now, not: null },
        priority: { not: CasePriority.URGENT },
      },
      select: { id: true, priority: true },
    });
    let count = 0;
    for (const row of candidates) {
      const next = row.priority === CasePriority.NORMAL ? CasePriority.HIGH : CasePriority.URGENT;
      await this.prisma.case.update({
        where: { id: row.id },
        data: { priority: next },
      });
      count++;
    }
    return count;
  }
}
