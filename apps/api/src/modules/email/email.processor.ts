import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QUEUE_EMAIL } from '../../infra/queue/queue.constants';
import { decrypt } from '../../common/crypto/encryption';
import type { EmailJobPayload } from './email.service';

/**
 * BullMQ worker that sends emails via Nodemailer. Like the reminders
 * processor, all useful state lives in the DB row — the job payload is
 * just a pointer. We re-fetch account + message at send time so any
 * last-second edits (e.g. account password rotation) are picked up.
 *
 * On success: status → SENT, sentAt + messageId recorded.
 * On failure: status → FAILED, errorMessage stored. BullMQ's default
 * retry policy applies (3 attempts with backoff).
 */
@Processor(QUEUE_EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    const { emailMessageId, tenantId } = job.data;
    this.logger.log(`Sending email id=${emailMessageId} tenant=${tenantId}`);

    // Re-fetch the message row
    const message = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailMessage.findFirst({ where: { id: emailMessageId, tenantId } }),
    );
    if (!message) {
      this.logger.warn(`Email ${emailMessageId} not found — dropped`);
      return;
    }
    if (message.status !== 'QUEUED') {
      this.logger.log(`Email ${emailMessageId} already ${message.status} — skipping`);
      return;
    }

    // Re-fetch the account for SMTP credentials
    const account = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailAccount.findFirst({
        where: { id: message.accountId, tenantId, deletedAt: null },
      }),
    );
    if (!account) {
      await this.markFailed(tenantId, emailMessageId, 'Email account deleted or not found');
      return;
    }

    // Mark as SENDING
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: 'SENDING' },
      }),
    );

    try {
      const transport = createTransport({
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: {
          user: account.smtpUser,
          pass: decrypt(account.smtpPassEnc),
        },
      });

      const result = await transport.sendMail({
        from: `"${account.fromName}" <${account.fromEmail}>`,
        to: message.toAddresses.join(', '),
        cc: message.ccAddresses.length > 0 ? message.ccAddresses.join(', ') : undefined,
        bcc: message.bccAddresses.length > 0 ? message.bccAddresses.join(', ') : undefined,
        subject: message.subject,
        html: message.bodyHtml,
        text: message.bodyText ?? undefined,
      });

      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.emailMessage.update({
          where: { id: emailMessageId },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            messageId: result.messageId ?? null,
          },
        }),
      );

      // Activity on the subject's timeline
      try {
        await this.prisma.runWithTenant(tenantId, async (tx) => {
          await tx.activity.create({
            data: {
              tenantId,
              subjectType: message.subjectType,
              subjectId: message.subjectId,
              actorId: message.createdById ?? null,
              action: 'email.sent',
              metadata: {
                emailMessageId,
                to: message.toAddresses,
                subject: message.subject,
              },
            },
          });
        });
      } catch (err) {
        this.logger.error(`Failed to write activity for sent email: ${(err as Error).message}`);
      }

      await this.audit.log({
        tenantId,
        actorId: message.createdById ?? undefined,
        action: 'email.sent',
        subjectType: message.subjectType.toLowerCase(),
        subjectId: message.subjectId,
        metadata: { emailMessageId, messageId: result.messageId },
      });

      this.logger.log(`Email ${emailMessageId} sent (SMTP messageId=${result.messageId})`);
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error(`Email ${emailMessageId} failed: ${errorMessage}`);
      await this.markFailed(tenantId, emailMessageId, errorMessage);
      // Re-throw so BullMQ retries
      throw err;
    }
  }

  private async markFailed(tenantId: string, emailMessageId: string, errorMessage: string): Promise<void> {
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: 'FAILED', errorMessage },
      }),
    );
  }
}
