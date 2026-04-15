import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailAccount, EmailMessage, Prisma } from '@prisma/client';
import {
  CreateEmailAccountDto,
  ListEmailsQueryDto,
  SendEmailDto,
  UpdateEmailAccountDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { SubjectResolver } from '../activities/subject-resolver';
import { EmailTrackingService } from '../email-tracking/email-tracking.service';
import { encrypt, decrypt } from '../../common/crypto/encryption';
import { QUEUE_EMAIL } from '../../infra/queue/queue.constants';
import { CursorPage, makeCursorPage } from '../../common/pagination';

/** Narrow tenant context to require userId (email ops need an authenticated user). */
function requireUserId(ctx: { tenantId: string; userId?: string }): { tenantId: string; userId: string } {
  if (!ctx.userId) {
    throw new BadRequestException({ code: 'AUTH_REQUIRED', message: 'Email operations require an authenticated user' });
  }
  return ctx as { tenantId: string; userId: string };
}

export interface EmailJobPayload {
  emailMessageId: string;
  tenantId: string;
}

/**
 * Sanitise an EmailAccount for API responses — strip the encrypted
 * password. The FE never needs it; re-entering it on update is the
 * safest UX pattern.
 */
function sanitiseAccount(a: EmailAccount): Omit<EmailAccount, 'smtpPassEnc'> & { smtpPassEnc?: never } {
  const { smtpPassEnc: _, ...rest } = a;
  return rest;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly subjects: SubjectResolver,
    private readonly tracking: EmailTrackingService,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
  ) {}

  // ─── Email Accounts ─────────────────────────────────────────────

  async createAccount(dto: CreateEmailAccountDto): Promise<Omit<EmailAccount, 'smtpPassEnc'>> {
    const ctx = requireUserId(requireTenantContext());
    const smtpPassEnc = encrypt(dto.smtpPass);

    // If this is the default, unset any existing default for this user
    if (dto.isDefault) {
      await this.unsetDefaultAccount(ctx.tenantId, ctx.userId);
    }

    const account = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailAccount.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          label: dto.label,
          smtpHost: dto.smtpHost,
          smtpPort: dto.smtpPort,
          smtpSecure: dto.smtpSecure,
          smtpUser: dto.smtpUser,
          smtpPassEnc,
          fromName: dto.fromName,
          fromEmail: dto.fromEmail,
          isDefault: dto.isDefault,
        },
      }),
    );

    await this.audit.log({
      action: 'email_account.create',
      subjectType: 'email_account',
      subjectId: account.id,
      metadata: { label: account.label, fromEmail: account.fromEmail },
    });
    return sanitiseAccount(account);
  }

  async listAccounts(): Promise<Omit<EmailAccount, 'smtpPassEnc'>[]> {
    const ctx = requireUserId(requireTenantContext());
    const accounts = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailAccount.findMany({
        where: { tenantId: ctx.tenantId, userId: ctx.userId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
    );
    return accounts.map(sanitiseAccount);
  }

  async findAccount(id: string): Promise<EmailAccount> {
    const ctx = requireUserId(requireTenantContext());
    const account = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailAccount.findFirst({
        where: { id, tenantId: ctx.tenantId, userId: ctx.userId, deletedAt: null },
      }),
    );
    if (!account) {
      throw new NotFoundException({ code: 'EMAIL_ACCOUNT_NOT_FOUND', message: 'Email account not found' });
    }
    return account;
  }

  async updateAccount(id: string, dto: UpdateEmailAccountDto): Promise<Omit<EmailAccount, 'smtpPassEnc'>> {
    await this.findAccount(id); // existence + ownership check
    const ctx = requireUserId(requireTenantContext());

    if (dto.isDefault) {
      await this.unsetDefaultAccount(ctx.tenantId, ctx.userId);
    }

    const data: Prisma.EmailAccountUpdateInput = {
      ...(dto.label !== undefined ? { label: dto.label } : {}),
      ...(dto.smtpHost !== undefined ? { smtpHost: dto.smtpHost } : {}),
      ...(dto.smtpPort !== undefined ? { smtpPort: dto.smtpPort } : {}),
      ...(dto.smtpSecure !== undefined ? { smtpSecure: dto.smtpSecure } : {}),
      ...(dto.smtpUser !== undefined ? { smtpUser: dto.smtpUser } : {}),
      ...(dto.smtpPass !== undefined ? { smtpPassEnc: encrypt(dto.smtpPass) } : {}),
      ...(dto.fromName !== undefined ? { fromName: dto.fromName } : {}),
      ...(dto.fromEmail !== undefined ? { fromEmail: dto.fromEmail } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
    };

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailAccount.update({ where: { id }, data }),
    );

    await this.audit.log({
      action: 'email_account.update',
      subjectType: 'email_account',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return sanitiseAccount(updated);
  }

  async removeAccount(id: string): Promise<void> {
    const existing = await this.findAccount(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailAccount.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'email_account.delete',
      subjectType: 'email_account',
      subjectId: id,
      metadata: { label: existing.label },
    });
  }

  /** Decrypt the SMTP password for a given account. Used by the processor. */
  decryptPassword(account: EmailAccount): string {
    return decrypt(account.smtpPassEnc);
  }

  // ─── Email Messages ─────────────────────────────────────────────

  /**
   * Queue an email for sending. Creates a QUEUED row and enqueues a BullMQ
   * job. The processor picks it up, sends via Nodemailer, and flips the
   * status. Returns immediately — the FE polls or sees the status in the
   * email list.
   */
  async send(dto: SendEmailDto): Promise<EmailMessage> {
    const ctx = requireUserId(requireTenantContext());

    // Validate account belongs to this user
    const account = await this.findAccount(dto.accountId);

    // Validate subject exists
    await this.subjects.assertExists(dto.subjectType, dto.subjectId);

    // Two-phase write so tracking URLs can embed the final message id.
    // Phase 1: insert with original body. Phase 2: rewrite + update. Both
    // run in the same tenant transaction so no observable intermediate state.
    const message = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const created = await tx.emailMessage.create({
        data: {
          tenantId: ctx.tenantId,
          accountId: account.id,
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          toAddresses: dto.toAddresses,
          ccAddresses: dto.ccAddresses,
          bccAddresses: dto.bccAddresses,
          subject: dto.subject,
          bodyHtml: dto.bodyHtml,
          bodyText: dto.bodyText ?? null,
          status: 'QUEUED',
          createdById: ctx.userId,
        },
      });
      const tracked = this.tracking.injectTracking(created.id, dto.bodyHtml);
      if (tracked !== dto.bodyHtml) {
        return tx.emailMessage.update({
          where: { id: created.id },
          data: { bodyHtml: tracked },
        });
      }
      return created;
    });

    const payload: EmailJobPayload = {
      emailMessageId: message.id,
      tenantId: ctx.tenantId,
    };
    // jobId = message.id for idempotency (same as reminders pattern)
    await this.emailQueue.add('send', payload, { jobId: message.id });

    await this.audit.log({
      action: 'email.send',
      subjectType: dto.subjectType.toLowerCase(),
      subjectId: dto.subjectId,
      metadata: {
        emailMessageId: message.id,
        to: dto.toAddresses,
        subject: dto.subject,
      },
    });

    return message;
  }

  async listMessages(q: ListEmailsQueryDto): Promise<CursorPage<EmailMessage>> {
    const ctx = requireTenantContext();
    const where: Prisma.EmailMessageWhereInput = {
      tenantId: ctx.tenantId,
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };

    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailMessage.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findMessage(id: string): Promise<EmailMessage> {
    const ctx = requireTenantContext();
    const msg = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailMessage.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!msg) {
      throw new NotFoundException({ code: 'EMAIL_NOT_FOUND', message: 'Email message not found' });
    }
    return msg;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private async unsetDefaultAccount(tenantId: string, userId: string): Promise<void> {
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailAccount.updateMany({
        where: { tenantId, userId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      }),
    );
  }
}
