import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Reminder, SubjectType } from '@prisma/client';
import { CreateReminderDto, UpdateReminderDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { SubjectResolver } from '../activities/subject-resolver';
import { QUEUE_REMINDERS } from '../../infra/queue/queue.constants';

/**
 * Payload sent on the BullMQ `reminders` queue. The processor reads this
 * exact shape — keep it minimal so the job is robust to schema migrations.
 * The full reminder is re-fetched from DB at fire time (the row is the
 * source of truth, not the cached payload).
 */
export interface ReminderJobPayload {
  reminderId: string;
  tenantId: string;
}

export interface ReminderListPage {
  data: Reminder[];
  nextCursor: string | null;
}

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly subjects: SubjectResolver,
    @InjectQueue(QUEUE_REMINDERS) private readonly queue: Queue<ReminderJobPayload>,
  ) {}

  async create(
    subjectType: SubjectType,
    subjectId: string,
    dto: CreateReminderDto,
  ): Promise<Reminder> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();

    const reminder = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.create({
        data: {
          tenantId: ctx.tenantId,
          subjectType,
          subjectId,
          actorId: ctx.userId ?? null,
          title: dto.title,
          body: dto.body ?? null,
          remindAt: dto.remindAt,
        },
      }),
    );

    await this.enqueueDelayed(reminder.id, ctx.tenantId, reminder.remindAt);

    await this.audit.log({
      action: 'reminder.create',
      subjectType: subjectType.toLowerCase(),
      subjectId,
      metadata: { reminderId: reminder.id, remindAt: reminder.remindAt.toISOString() },
    });
    await this.activities.log({
      subjectType,
      subjectId,
      action: 'reminder.created',
      metadata: { reminderId: reminder.id, title: reminder.title },
    });

    return reminder;
  }

  async listForSubject(
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<Reminder[]> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.findMany({
        where: {
          tenantId: ctx.tenantId,
          subjectType,
          subjectId,
          deletedAt: null,
        },
        // PENDING first by remindAt asc; everything else by remindAt desc.
        orderBy: [{ status: 'asc' }, { remindAt: 'asc' }],
      }),
    );
  }

  /**
   * "My upcoming reminders" — current user's PENDING reminders, ordered by
   * remindAt ascending (the soonest first), with cursor pagination on
   * (remindAt, id). Cursor format = ISO timestamp of the last entry.
   */
  async listMine(cursor: string | undefined, limit: number): Promise<ReminderListPage> {
    const ctx = requireTenantContext();
    const cursorDate = cursor ? new Date(cursor) : undefined;
    const validCursor = cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : undefined;

    const rows = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.findMany({
        where: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          status: 'PENDING',
          deletedAt: null,
          ...(validCursor ? { remindAt: { gt: validCursor } } : {}),
        },
        orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
    );

    if (rows.length > limit) {
      const data = rows.slice(0, limit);
      return { data, nextCursor: data[data.length - 1].remindAt.toISOString() };
    }
    return { data: rows, nextCursor: null };
  }

  async findOne(id: string): Promise<Reminder> {
    const ctx = requireTenantContext();
    const reminder = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!reminder) {
      throw new NotFoundException({
        code: 'REMINDER_NOT_FOUND',
        message: 'Reminder not found',
      });
    }
    return reminder;
  }

  /**
   * Update title/body/remindAt. If `remindAt` changes, the BullMQ delayed
   * job is cancelled and re-enqueued — we cannot edit a job's `delay` in
   * place. Status changes go through dismiss(), not here, so this method
   * never has to think about the FIRED/DISMISSED branches.
   */
  async update(id: string, dto: UpdateReminderDto): Promise<Reminder> {
    const existing = await this.findOne(id);
    if (existing.status !== 'PENDING') {
      throw new NotFoundException({
        code: 'REMINDER_NOT_EDITABLE',
        message: `Cannot edit a ${existing.status} reminder`,
      });
    }

    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.body !== undefined ? { body: dto.body } : {}),
          ...(dto.remindAt !== undefined ? { remindAt: dto.remindAt } : {}),
        },
      }),
    );

    if (dto.remindAt !== undefined) {
      // Cancel old job + re-enqueue at the new delay. removeJob is a no-op
      // if the job has already moved on (e.g. completed concurrently),
      // so this is safe under races.
      await this.queue.remove(id).catch(() => undefined);
      await this.enqueueDelayed(id, ctx.tenantId, updated.remindAt);
    }

    await this.audit.log({
      action: 'reminder.update',
      subjectType: existing.subjectType.toLowerCase(),
      subjectId: existing.subjectId,
      metadata: { reminderId: id, remindAt: updated.remindAt.toISOString() },
    });

    return updated;
  }

  /**
   * Dismiss = user acknowledged the reminder. Cancels the BullMQ job and
   * marks the row DISMISSED. Idempotent: dismissing a non-PENDING reminder
   * is a no-op (returns the existing row), so accidental double-clicks
   * don't blow up.
   */
  async dismiss(id: string): Promise<Reminder> {
    const existing = await this.findOne(id);
    if (existing.status !== 'PENDING') return existing;

    const ctx = requireTenantContext();
    await this.queue.remove(id).catch(() => undefined);
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.update({ where: { id }, data: { status: 'DISMISSED' } }),
    );
    await this.audit.log({
      action: 'reminder.dismiss',
      subjectType: existing.subjectType.toLowerCase(),
      subjectId: existing.subjectId,
      metadata: { reminderId: id },
    });
    await this.activities.log({
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      action: 'reminder.dismissed',
      metadata: { reminderId: id, title: existing.title },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.queue.remove(id).catch(() => undefined);
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.reminder.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'CANCELLED' },
      }),
    );
    await this.audit.log({
      action: 'reminder.delete',
      subjectType: existing.subjectType.toLowerCase(),
      subjectId: existing.subjectId,
      metadata: { reminderId: id },
    });
  }

  /**
   * Add a delayed job to the BullMQ queue. We pin `jobId = reminderId` so
   * accidental double-enqueues collapse (e.g. from a retried request) and
   * so update/dismiss/delete can `queue.remove(id)` without tracking a
   * separate jobId column. delay = max(0, remindAt - now).
   */
  private async enqueueDelayed(
    reminderId: string,
    tenantId: string,
    remindAt: Date,
  ): Promise<void> {
    const delay = Math.max(0, remindAt.getTime() - Date.now());
    await this.queue.add(
      'fire',
      { reminderId, tenantId },
      {
        jobId: reminderId,
        delay,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }
}
