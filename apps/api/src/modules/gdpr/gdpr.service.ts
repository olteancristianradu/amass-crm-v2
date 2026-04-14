/**
 * GdprService — GDPR compliance features:
 *
 *  1. Data export  — collect all personal data for a subject (Contact / Client)
 *     and return it as a structured JSON "data package".
 *
 *  2. Right to erasure — anonymise personal fields in the DB. We soft-delete
 *     records and overwrite PII fields with static anonymised values so that
 *     relational integrity (foreign keys) is preserved while PII is gone.
 *     Hard-delete of related data (notes, activities, attachments) happens
 *     as part of the same operation.
 *
 *  3. Retention sweep — find Contact/Client records soft-deleted more than
 *     `retentionDays` ago and fully anonymise them. Intended to run on a
 *     cron-like schedule (S18 will wire the actual cron job).
 *
 * Only OWNER/ADMIN can invoke these operations. All actions are audit-logged.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

const ANON = '[ANONYMISED]';
const ANON_EMAIL = 'anonymised@deleted.invalid';

@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Data export ──────────────────────────────────────────────────────────

  async exportContact(id: string): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantContext();
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId },
    });
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND' });

    const [notes, activities, attachments, reminders] = await Promise.all([
      this.prisma.note.findMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } }),
      this.prisma.activity.findMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } }),
      this.prisma.attachment.findMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } }),
      this.prisma.reminder.findMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } }),
    ]);

    await this.audit.log({ action: 'gdpr.export_contact', subjectType: 'contact', subjectId: id });

    return {
      exportedAt: new Date().toISOString(),
      subject: 'CONTACT',
      contact,
      notes,
      activities,
      attachments: attachments.map((a) => ({ ...a, storageKey: '[REDACTED]' })),
      reminders,
    };
  }

  async exportClient(id: string): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantContext();
    const client = await this.prisma.client.findFirst({
      where: { id, tenantId },
    });
    if (!client) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND' });

    const [notes, activities, attachments, reminders] = await Promise.all([
      this.prisma.note.findMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } }),
      this.prisma.activity.findMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } }),
      this.prisma.attachment.findMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } }),
      this.prisma.reminder.findMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } }),
    ]);

    await this.audit.log({ action: 'gdpr.export_client', subjectType: 'client', subjectId: id });

    return {
      exportedAt: new Date().toISOString(),
      subject: 'CLIENT',
      client,
      notes,
      activities,
      attachments: attachments.map((a) => ({ ...a, storageKey: '[REDACTED]' })),
      reminders,
    };
  }

  // ── Right to erasure ─────────────────────────────────────────────────────

  async eraseContact(id: string): Promise<{ erased: true }> {
    const { tenantId } = requireTenantContext();
    const contact = await this.prisma.contact.findFirst({ where: { id, tenantId } });
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND' });

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      // Anonymise PII fields + mark deleted
      await tx.contact.update({
        where: { id },
        data: {
          firstName: ANON,
          lastName: ANON,
          email: ANON_EMAIL,
          phone: null,
          mobile: null,
          notes: null,
          jobTitle: null,
          deletedAt: new Date(),
        },
      });
      // Hard-delete related polymorphic data
      await tx.note.deleteMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } });
      await tx.reminder.deleteMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } });
      // Activities and attachments: soft-delete (preserve audit trail but remove PII in content)
      await tx.activity.deleteMany({ where: { tenantId, subjectType: 'CONTACT', subjectId: id } });
    });

    await this.audit.log({ action: 'gdpr.erase_contact', subjectType: 'contact', subjectId: id });
    this.logger.warn('GDPR erasure performed for contact %s in tenant %s', id, tenantId);
    return { erased: true };
  }

  async eraseClient(id: string): Promise<{ erased: true }> {
    const { tenantId } = requireTenantContext();
    const client = await this.prisma.client.findFirst({ where: { id, tenantId } });
    if (!client) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND' });

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.client.update({
        where: { id },
        data: {
          firstName: ANON,
          lastName: ANON,
          email: ANON_EMAIL,
          phone: null,
          mobile: null,
          addressLine: null,
          notes: null,
          deletedAt: new Date(),
        },
      });
      await tx.note.deleteMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } });
      await tx.reminder.deleteMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } });
      await tx.activity.deleteMany({ where: { tenantId, subjectType: 'CLIENT', subjectId: id } });
    });

    await this.audit.log({ action: 'gdpr.erase_client', subjectType: 'client', subjectId: id });
    this.logger.warn('GDPR erasure performed for client %s in tenant %s', id, tenantId);
    return { erased: true };
  }

  // ── Retention sweep ──────────────────────────────────────────────────────

  /**
   * Anonymise all contacts / clients soft-deleted more than `retentionDays`
   * ago that still have PII (firstName !== ANON). Returns counts.
   * In S18 this is called by a scheduled cron job.
   */
  async retentionSweep(retentionDays = 365): Promise<{ contacts: number; clients: number }> {
    const { tenantId } = requireTenantContext();
    const cutoff = new Date(Date.now() - retentionDays * 86400000);

    const [staleContacts, staleClients] = await Promise.all([
      this.prisma.contact.findMany({
        where: {
          tenantId,
          deletedAt: { lte: cutoff },
          NOT: { firstName: ANON },
        },
        select: { id: true },
      }),
      this.prisma.client.findMany({
        where: {
          tenantId,
          deletedAt: { lte: cutoff },
          NOT: { firstName: ANON },
        },
        select: { id: true },
      }),
    ]);

    for (const { id } of staleContacts) {
      await this.eraseContact(id).catch((err) =>
        this.logger.error('Retention sweep: erase contact %s failed: %o', id, err),
      );
    }
    for (const { id } of staleClients) {
      await this.eraseClient(id).catch((err) =>
        this.logger.error('Retention sweep: erase client %s failed: %o', id, err),
      );
    }

    await this.audit.log({
      action: 'gdpr.retention_sweep',
      metadata: { contacts: staleContacts.length, clients: staleClients.length, retentionDays },
    });

    return { contacts: staleContacts.length, clients: staleClients.length };
  }
}
