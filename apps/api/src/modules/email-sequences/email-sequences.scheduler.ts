/**
 * Email sequences ticker.
 *
 * Sequences are multi-step email cadences attached to a contact ("after
 * Day 0 send intro, +2 days send follow-up, +7 days send final"). A
 * SequenceEnrollment tracks the per-contact cursor (`currentStep`) and
 * next wake-up time (`nextSendAt`).
 *
 * This scheduler fires every minute. On each tick it finds enrollments
 * whose `nextSendAt` is due, sends the next step via EmailService, and
 * advances the cursor. When the last step is reached, the enrollment
 * is marked COMPLETED.
 *
 * Defense notes:
 *   - Runs OUTSIDE request ALS (cron trigger), so every DB query is
 *     wrapped in `runWithTenant(tenantId, fn)` — same pattern as the
 *     workflows BullMQ processor.
 *   - Sequences without steps are auto-completed to avoid stuck rows.
 *   - A single enrollment advances at most one step per tick; catastrophic
 *     clock drift can't cause all 10 steps to flood at once.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EmailService } from '../email/email.service';

const TICK_BATCH_SIZE = 100;

@Injectable()
export class EmailSequencesScheduler {
  private readonly logger = new Logger(EmailSequencesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Fires every minute — advances every enrollment whose next_send_at is due. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'email-sequences-tick' })
  async tick(): Promise<void> {
    const now = new Date();
    // NOTE: raw prisma (no tenant context) — the scheduler looks across
    // ALL tenants. Each per-tenant advance below re-enters via runWithTenant.
    const due = await this.prisma.sequenceEnrollment.findMany({
      where: {
        status: 'ACTIVE',
        nextSendAt: { lte: now, not: null },
      },
      take: TICK_BATCH_SIZE,
      orderBy: { nextSendAt: 'asc' },
      select: { id: true, tenantId: true },
    });
    if (due.length === 0) return;
    this.logger.debug(`Email sequences tick — ${due.length} enrollments due`);
    for (const row of due) {
      try {
        await this.advanceOne(row.tenantId, row.id);
      } catch (err) {
        this.logger.warn(
          `Failed to advance enrollment ${row.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async advanceOne(tenantId: string, enrollmentId: string): Promise<void> {
    await this.prisma.runWithTenant(tenantId, async (tx) => {
      const enr = await tx.sequenceEnrollment.findFirst({
        where: { id: enrollmentId, tenantId, status: 'ACTIVE' },
        include: {
          sequence: {
            include: { steps: { orderBy: { order: 'asc' } } },
          },
        },
      });
      if (!enr) return;
      const steps = enr.sequence.steps;
      const nextIdx = enr.currentStep;
      // Out of steps → complete.
      if (nextIdx >= steps.length) {
        await tx.sequenceEnrollment.update({
          where: { id: enr.id },
          data: { status: 'COMPLETED', completedAt: new Date(), nextSendAt: null },
        });
        return;
      }
      const step = steps[nextIdx];

      // Send the email transactionally. Errors bubble up and cause the
      // outer try/catch to log + leave the enrollment due (will retry
      // next tick). We intentionally do NOT decrement on failure so a
      // perpetually-broken SMTP account doesn't mask as success.
      await this.email.sendTransactional(tenantId, {
        to: enr.toEmail,
        subject: step.subject,
        bodyHtml: step.bodyHtml,
        bodyText: step.bodyText ?? undefined,
      });

      // Advance cursor. If this was the last step, mark complete.
      const isLast = nextIdx + 1 >= steps.length;
      const nextSend = isLast ? null : new Date(Date.now() + steps[nextIdx + 1].delayDays * 86_400_000);
      await tx.sequenceEnrollment.update({
        where: { id: enr.id },
        data: {
          currentStep: nextIdx + 1,
          nextSendAt: nextSend,
          status: isLast ? 'COMPLETED' : 'ACTIVE',
          completedAt: isLast ? new Date() : null,
        },
      });
    });
  }
}
