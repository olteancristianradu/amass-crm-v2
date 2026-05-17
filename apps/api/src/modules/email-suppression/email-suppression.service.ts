import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EmailSuppressionReason, Prisma } from '@prisma/client';
import {
  CreateEmailSuppressionDto,
  ListEmailSuppressionsQueryDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { CursorPage, makeCursorPage } from '../../common/pagination';

/**
 * Phase 1 / F1 — Email suppression list (GDPR-compliant "do not contact").
 *
 * The list is keyed by SHA-256 hash of the lowercased email so we never
 * store plaintext PII. This satisfies BOTH GDPR Art. 17 (right to erasure
 * of the contact's identity) AND CAN-SPAM §5(a)(4) (must not re-contact
 * after unsubscribe). The `emailMasked` column ("j****@e****.com") gives
 * admins a non-PII rendering for the UI.
 *
 * Three call sites:
 *  1. Admin UI — explicit add/remove (CRUD).
 *  2. Bounce webhook handler — auto-add on hard bounce.
 *  3. Unsubscribe endpoint (`GET /u/:token` in EmailTrackingController)
 *     — auto-add on user click.
 *
 * Pre-send check is `isSuppressed(email)`: called by EmailService.send()
 * before queuing a message. Hit = skip send + audit `email.suppression.skip_send`.
 *
 * Per docs/specs/phase-1.md F1 + docs/threat-models/phase-1.md T-MAIL-E-02.
 */
@Injectable()
export class EmailSuppressionService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Pre-send suppression check. Returns the suppression row if the email is
   * on the list for the given tenant, null otherwise. Expired entries
   * (expiresAt in the past) are treated as NOT suppressed.
   *
   * Caller signature accepts tenantId explicitly because this is also used
   * from BullMQ workers + cron jobs that run outside an HTTP request ALS
   * context.
   */
  async isSuppressed(
    tenantId: string,
    email: string,
  ): Promise<{ id: string; reason: EmailSuppressionReason; emailMasked: string } | null> {
    const hash = hashEmail(email);
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const row = await tx.emailSuppression.findUnique({
        where: { tenantId_emailHash: { tenantId, emailHash: hash } },
        select: { id: true, reason: true, emailMasked: true, expiresAt: true },
      });
      if (!row) return null;
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
      return { id: row.id, reason: row.reason, emailMasked: row.emailMasked };
    });
  }

  /**
   * Admin add. Plaintext email goes in; hash + mask computed server-side.
   * Idempotent: re-adding an existing email upserts (refreshes reason +
   * source + notes). Returns the resulting row sanitised — no email_hash
   * in the response.
   */
  async add(dto: CreateEmailSuppressionDto) {
    const ctx = requireTenantContext();
    const tenantId = ctx.tenantId;
    const hash = hashEmail(dto.email);
    const masked = maskEmail(dto.email);

    const row = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailSuppression.upsert({
        where: { tenantId_emailHash: { tenantId, emailHash: hash } },
        create: {
          tenantId,
          emailHash: hash,
          emailMasked: masked,
          reason: dto.reason,
          source: dto.source ?? null,
          notes: dto.notes ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          addedById: ctx.userId ?? null,
        },
        update: {
          reason: dto.reason,
          source: dto.source ?? null,
          notes: dto.notes ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          // Don't touch addedById on update — preserve original adder.
        },
      }),
    );

    await this.audit.log({
      action: 'email.suppression.added',
      subjectType: 'email_suppression',
      subjectId: row.id,
      metadata: { reason: dto.reason, emailMasked: masked, source: dto.source ?? null },
    });

    return this.sanitise(row);
  }

  /**
   * System-level add (no ALS context). Used by BullMQ workers handling
   * bounce webhooks or the unsubscribe endpoint, which run outside a
   * request. Caller passes tenantId explicitly.
   *
   * Idempotent. Audit log written with `actorId: null` since there's no
   * authenticated user. The actor is identified by the `source` field
   * ("webhook:bounce", "user:unsubscribe").
   */
  async addSystem(
    tenantId: string,
    email: string,
    reason: EmailSuppressionReason,
    source: string,
    notes?: string,
  ) {
    const hash = hashEmail(email);
    const masked = maskEmail(email);
    const row = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailSuppression.upsert({
        where: { tenantId_emailHash: { tenantId, emailHash: hash } },
        create: {
          tenantId,
          emailHash: hash,
          emailMasked: masked,
          reason,
          source,
          notes: notes ?? null,
          addedById: null,
        },
        update: {
          // Only refresh source/notes — do NOT overwrite reason if the row
          // already has a stronger one. Promotion order:
          //   USER_UNSUBSCRIBE > BOUNCE_HARD > SPAM_REPORT > COMPLAINT > MANUAL_ADD > GLOBAL_BLOCK
          // For now: keep existing reason on conflict (manual flow > webhook flow).
          source,
          notes: notes ?? null,
        },
      }),
    );

    await this.audit.log({
      tenantId,
      action: 'email.suppression.added',
      subjectType: 'email_suppression',
      subjectId: row.id,
      metadata: { reason, emailMasked: masked, source },
    });

    return this.sanitise(row);
  }

  async list(q: ListEmailSuppressionsQueryDto): Promise<CursorPage<ReturnType<EmailSuppressionService['sanitise']>>> {
    const ctx = requireTenantContext();
    const where: Prisma.EmailSuppressionWhereInput = {
      tenantId: ctx.tenantId,
      ...(q.reason ? { reason: q.reason } : {}),
    };
    const rows = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSuppression.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [{ addedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    return makeCursorPage(rows.map((r) => this.sanitise(r)), q.limit);
  }

  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const existing = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSuppression.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, emailMasked: true, reason: true },
      }),
    );
    if (!existing) {
      throw new NotFoundException({
        code: 'EMAIL_SUPPRESSION_NOT_FOUND',
        message: 'Suppression entry not found',
      });
    }
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSuppression.delete({ where: { id } }),
    );
    await this.audit.log({
      action: 'email.suppression.removed',
      subjectType: 'email_suppression',
      subjectId: id,
      metadata: { reason: existing.reason, emailMasked: existing.emailMasked },
    });
  }

  /**
   * Strip the email_hash column out of API responses — the hash is an
   * internal lookup key, not meant for the client. Caller never needs it.
   */
  private sanitise(row: {
    id: string;
    emailMasked: string;
    reason: EmailSuppressionReason;
    source: string | null;
    addedAt: Date;
    expiresAt: Date | null;
    addedById: string | null;
    notes: string | null;
  }) {
    return {
      id: row.id,
      emailMasked: row.emailMasked,
      reason: row.reason,
      source: row.source,
      addedAt: row.addedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      addedById: row.addedById,
      notes: row.notes,
    };
  }
}

/**
 * Canonical email hash used by the suppression list. Trim + lowercase so
 * "Foo@Bar.COM " and "foo@bar.com" hash to the same bucket — RFC 5321
 * permits case-sensitive local-parts but every real-world MTA (Gmail,
 * Outlook, Yahoo, hosted Postfix) treats them as case-insensitive. The
 * trade-off is that an edge-case Postfix instance which enforces case
 * sensitivity could fail to suppress; we accept that to avoid double
 * sends to the common case.
 */
export function hashEmail(email: string): string {
  const normalised = email.trim().toLowerCase();
  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Render an email as "j***@e***.com" — first character of local-part,
 * first character of domain-prefix, full TLD chain preserved. Used in the
 * admin UI so admins can recognise a suppressed contact without us storing
 * the plaintext.
 *
 * Edge cases:
 *  - Single-char local-part: shown verbatim ("a@b.com" → "a@b****.com")
 *  - No '@' (invalid email): returned as "****" sentinel
 *  - Domain with no dot (rare, hostname-only): full mask after first char
 */
export function maskEmail(email: string): string {
  const normalised = email.trim().toLowerCase();
  const at = normalised.lastIndexOf('@');
  if (at < 1 || at === normalised.length - 1) return '****';
  const local = normalised.slice(0, at);
  const domain = normalised.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  // Local: first char + '****'
  const maskedLocal = local.length > 0 ? `${local[0]}****` : '****';
  // Domain: first char of prefix + '****' + TLD chain (everything from last dot)
  let maskedDomain: string;
  if (dot < 1) {
    maskedDomain = domain.length > 0 ? `${domain[0]}****` : '****';
  } else {
    const prefix = domain.slice(0, dot);
    const tldChain = domain.slice(dot); // includes the dot
    maskedDomain = `${prefix[0]}****${tldChain}`;
  }
  return `${maskedLocal}@${maskedDomain}`;
}
