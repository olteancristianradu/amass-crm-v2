import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SubjectType, Task } from '@prisma/client';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { SubjectResolver } from '../activities/subject-resolver';
import { CursorPage, makeCursorPage } from '../../common/pagination';

/**
 * TasksService — polymorphic to-dos. A task attaches to EITHER a Deal
 * (via dealId) OR a SubjectType+SubjectId (Company/Contact/Client), never
 * both. The Zod schema has a superRefine for this, but the service
 * re-checks before touching Prisma because Zod validation can be bypassed
 * at internal call sites.
 *
 * Status flow:
 *   OPEN → complete() → DONE  (stamps completedAt, writes activity)
 *   DONE → reopen()   → OPEN  (clears completedAt)
 * `status` is deliberately NOT in UpdateTaskDto — clients must use the
 * dedicated endpoints so the activity trail stays accurate.
 *
 * /tasks/me shortcut: the controller injects `assigneeId = current user`
 * and `status = OPEN` before delegating to list().
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly subjects: SubjectResolver,
  ) {}

  async create(dto: CreateTaskDto): Promise<Task> {
    this.assertExactlyOneLink(dto);
    if (dto.dealId) {
      await this.assertDealExists(dto.dealId);
    } else if (dto.subjectType && dto.subjectId) {
      await this.subjects.assertExists(dto.subjectType as SubjectType, dto.subjectId);
    }

    const ctx = requireTenantContext();
    const task = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          title: dto.title,
          description: dto.description ?? null,
          dueAt: dto.dueAt ?? null,
          priority: dto.priority,
          assigneeId: dto.assigneeId ?? null,
          dealId: dto.dealId ?? null,
          subjectType: (dto.subjectType as SubjectType | undefined) ?? null,
          subjectId: dto.subjectId ?? null,
          createdById: ctx.userId ?? null,
        },
      }),
    );

    await this.audit.log({
      action: 'task.create',
      subjectType: 'task',
      subjectId: task.id,
      metadata: {
        title: task.title,
        dealId: task.dealId,
        linkedSubjectType: task.subjectType,
        linkedSubjectId: task.subjectId,
      },
    });
    if (task.subjectType && task.subjectId) {
      await this.activities.log({
        subjectType: task.subjectType,
        subjectId: task.subjectId,
        action: 'task.created',
        metadata: { taskId: task.id, title: task.title, dueAt: task.dueAt },
      });
    }
    return task;
  }

  async list(q: ListTasksQueryDto): Promise<CursorPage<Task>> {
    const ctx = requireTenantContext();
    const where: Prisma.TaskWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.subjectType ? { subjectType: q.subjectType as SubjectType } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.dueBefore ? { dueAt: { lte: q.dueBefore } } : {}),
    };

    // Order by dueAt asc NULLS LAST so overdue tasks surface first, then
    // undated tasks at the bottom. Prisma doesn't expose NULLS LAST on
    // Postgres directly without raw SQL, so we sort nulls last by adding
    // a secondary ordering on `createdAt desc`.
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [
          { dueAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Task> {
    const ctx = requireTenantContext();
    const task = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!task) throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        },
      }),
    );
    await this.audit.log({
      action: 'task.update',
      subjectType: 'task',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    if (existing.subjectType && existing.subjectId) {
      await this.activities.log({
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        action: 'task.updated',
        metadata: { taskId: id, fields: Object.keys(dto) },
      });
    }
    return updated;
  }

  async complete(id: string): Promise<Task> {
    const existing = await this.findOne(id);
    if (existing.status === 'DONE') return existing;
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.update({
        where: { id },
        data: { status: 'DONE', completedAt: new Date() },
      }),
    );
    await this.audit.log({
      action: 'task.complete',
      subjectType: 'task',
      subjectId: id,
    });
    if (existing.subjectType && existing.subjectId) {
      await this.activities.log({
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        action: 'task.completed',
        metadata: { taskId: id, title: existing.title },
      });
    }
    return updated;
  }

  async reopen(id: string): Promise<Task> {
    const existing = await this.findOne(id);
    if (existing.status === 'OPEN') return existing;
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.update({
        where: { id },
        data: { status: 'OPEN', completedAt: null },
      }),
    );
    await this.audit.log({
      action: 'task.reopen',
      subjectType: 'task',
      subjectId: id,
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.task.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'task.delete',
      subjectType: 'task',
      subjectId: id,
      metadata: { title: existing.title },
    });
  }

  // ---- internals ----

  private assertExactlyOneLink(dto: CreateTaskDto): void {
    const hasDeal = !!dto.dealId;
    const hasSubject = !!dto.subjectType && !!dto.subjectId;
    if (hasDeal && hasSubject) {
      throw new BadRequestException({
        code: 'TASK_LINK_INVALID',
        message: 'task cannot link to both a deal and a subject',
      });
    }
    if (!hasDeal && !hasSubject) {
      throw new BadRequestException({
        code: 'TASK_LINK_INVALID',
        message: 'task must link to a deal or a subject',
      });
    }
  }

  private async assertDealExists(dealId: string): Promise<void> {
    const ctx = requireTenantContext();
    const exists = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.deal.findFirst({
        where: { id: dealId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      }),
    );
    if (!exists) {
      throw new NotFoundException({ code: 'DEAL_NOT_FOUND', message: 'Deal not found' });
    }
  }
}
