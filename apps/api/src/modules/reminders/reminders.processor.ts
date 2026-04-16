import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WsGateway } from '../../infra/ws/ws.gateway';
import { QUEUE_REMINDERS } from '../../infra/queue/queue.constants';
import type { ReminderJobPayload } from './reminders.service';

/**
 * BullMQ worker that fires reminders. The job is a "ping": all useful
 * state lives in the DB row. We re-fetch the row at fire time and skip
 * if it's been dismissed/deleted in the meantime — that's the source of
 * truth, not the cached payload.
 *
 * Why no email/push here: this is the MVP. The MVP is "the reminder
 * exists, the firing logic works, the activity timeline shows the user
 * was reminded". S11 (Email) and S12+ (push/Twilio) plug into the
 * activities row downstream.
 */
@Processor(QUEUE_REMINDERS)
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ws: WsGateway,
  ) {
    super();
  }

  async process(job: Job<ReminderJobPayload>): Promise<void> {
    const { reminderId, tenantId } = job.data;
    this.logger.log(`Firing reminder id=${reminderId} tenant=${tenantId}`);

    const reminder = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reminder.findFirst({ where: { id: reminderId, tenantId } }),
    );
    if (!reminder) {
      this.logger.warn(`Reminder ${reminderId} not found at fire time — dropped`);
      return;
    }
    if (reminder.status !== 'PENDING' || reminder.deletedAt) {
      this.logger.log(`Reminder ${reminderId} already ${reminder.status} — skipping`);
      return;
    }

    const fired = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.reminder.update({
        where: { id: reminderId },
        data: { status: 'FIRED', firedAt: new Date() },
      }),
    );

    // Push real-time notification to all sessions in this tenant's room.
    this.ws.emitReminderFired(tenantId, {
      id: fired.id,
      title: fired.title,
      body: fired.body,
    });

    // Best-effort audit + activity. Worker runs outside an HTTP request,
    // so we pass tenant + actor explicitly (audit.log accepts overrides).
    await this.audit.log({
      tenantId,
      actorId: fired.actorId ?? undefined,
      action: 'reminder.fired',
      subjectType: fired.subjectType.toLowerCase(),
      subjectId: fired.subjectId,
      metadata: { reminderId, title: fired.title },
    });

    // ActivitiesService.log() reads tenant from AsyncLocalStorage which
    // is empty in worker context. Inline the write here — best-effort,
    // same as ActivitiesService (must NOT block on failure).
    try {
      await this.prisma.runWithTenant(tenantId, async (tx) => {
        await tx.activity.create({
          data: {
            tenantId,
            subjectType: fired.subjectType,
            subjectId: fired.subjectId,
            actorId: fired.actorId ?? null,
            action: 'reminder.fired',
            metadata: { reminderId, title: fired.title },
          },
        });
      });
    } catch (err) {
      this.logger.error(`Failed to write activity for fired reminder: ${(err as Error).message}`);
    }
  }
}
