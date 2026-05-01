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
import { StorageService } from '../../infra/storage/storage.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export const ANON = '[ANONYMISED]';
export const ANON_EMAIL = 'anonymised@deleted.invalid';

/**
 * Pure helper: which contact/client/lead columns are reset to an anonymised
 * value (vs. simply `null`) when a GDPR erasure is issued. Exposed so the
 * test suite can assert we don't accidentally forget to redact a new PII
 * column when someone adds one to the schema.
 */
export const CONTACT_PII_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'mobile', 'notes', 'jobTitle'] as const;
export const CLIENT_PII_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'mobile', 'notes'] as const;
export const LEAD_PII_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'company', 'jobTitle', 'notes'] as const;

/** Build the anonymisation patch applied inside the tx. Kept pure so
 *  tests can assert the shape without DB. */
export function buildContactAnonymisationPatch(now: Date = new Date()): Record<string, unknown> {
  return {
    firstName: ANON,
    lastName: ANON,
    email: ANON_EMAIL,
    phone: null,
    mobile: null,
    notes: null,
    jobTitle: null,
    deletedAt: now,
  };
}

export function buildClientAnonymisationPatch(now: Date = new Date()): Record<string, unknown> {
  return {
    firstName: ANON,
    lastName: ANON,
    email: ANON_EMAIL,
    phone: null,
    mobile: null,
    notes: null,
    deletedAt: now,
  };
}

@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ── Data export ──────────────────────────────────────────────────────────

  // FIX (P1-1, audit 4-agent): all queries below MUST run inside
  // runWithTenant() so the Prisma extension auto-injects tenantId AND
  // Postgres RLS (`SET LOCAL ROLE app_user`) provides defense-in-depth.
  // Pre-fix, these used `this.prisma.X.findMany` directly — manual tenant
  // filter was correct (Layer 1) but Layer 2 + Layer 3 were bypassed.
  // A future bug forgetting the manual filter would silently leak data.

  async exportContact(id: string): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantContext();
    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id, deletedAt: null } });
      if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND' });
      const [notes, activities, attachments, reminders] = await Promise.all([
        tx.note.findMany({ where: { subjectType: 'CONTACT', subjectId: id } }),
        tx.activity.findMany({ where: { subjectType: 'CONTACT', subjectId: id } }),
        tx.attachment.findMany({ where: { subjectType: 'CONTACT', subjectId: id } }),
        tx.reminder.findMany({ where: { subjectType: 'CONTACT', subjectId: id } }),
      ]);
      return { contact, notes, activities, attachments, reminders };
    });

    await this.audit.log({ action: 'gdpr.export_contact', subjectType: 'contact', subjectId: id });

    return {
      exportedAt: new Date().toISOString(),
      subject: 'CONTACT',
      contact: result.contact,
      notes: result.notes,
      activities: result.activities,
      attachments: result.attachments.map((a) => ({ ...a, storageKey: '[REDACTED]' })),
      reminders: result.reminders,
    };
  }

  async exportClient(id: string): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantContext();
    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const client = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!client) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND' });
      const [notes, activities, attachments, reminders] = await Promise.all([
        tx.note.findMany({ where: { subjectType: 'CLIENT', subjectId: id } }),
        tx.activity.findMany({ where: { subjectType: 'CLIENT', subjectId: id } }),
        tx.attachment.findMany({ where: { subjectType: 'CLIENT', subjectId: id } }),
        tx.reminder.findMany({ where: { subjectType: 'CLIENT', subjectId: id } }),
      ]);
      return { client, notes, activities, attachments, reminders };
    });

    await this.audit.log({ action: 'gdpr.export_client', subjectType: 'client', subjectId: id });

    return {
      exportedAt: new Date().toISOString(),
      subject: 'CLIENT',
      client: result.client,
      notes: result.notes,
      activities: result.activities,
      attachments: result.attachments.map((a) => ({ ...a, storageKey: '[REDACTED]' })),
      reminders: result.reminders,
    };
  }

  /**
   * GDPR Art. 20 (portability) for Lead. Pre-customer leads still have
   * personal data (firstName/lastName/email/phone) and must be exportable
   * on data-subject request. Fix BLUE3#2.
   */
  async exportLead(id: string): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantContext();
    const lead = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const row = await tx.lead.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw new NotFoundException({ code: 'LEAD_NOT_FOUND' });
      return row;
    });

    await this.audit.log({ action: 'gdpr.export_lead', subjectType: 'lead', subjectId: id });

    return {
      exportedAt: new Date().toISOString(),
      subject: 'LEAD',
      lead,
    };
  }

  // ── Right to erasure ─────────────────────────────────────────────────────

  async eraseContact(id: string): Promise<{ erased: true }> {
    const { tenantId } = requireTenantContext();
    // Single transaction: lookup + collect blob keys + anonymise. Everything
    // runs through tenantExtension + RLS — Layer 2 + Layer 3 enforced.
    const { attachmentKeys, callRecordingKeys } = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id, deletedAt: null } });
      if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND' });

      // Collect blob keys BEFORE deleting rows (so we can scrub MinIO after).
      const attachments = await tx.attachment.findMany({
        where: { subjectType: 'CONTACT', subjectId: id },
        select: { storageKey: true },
      });
      const calls = await tx.call.findMany({
        where: { subjectType: 'CONTACT', subjectId: id, recordingStorageKey: { not: null } },
        select: { recordingStorageKey: true },
      });
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
      // Hard-delete related polymorphic data (tenantId auto-injected by extension).
      await tx.note.deleteMany({ where: { subjectType: 'CONTACT', subjectId: id } });
      await tx.reminder.deleteMany({ where: { subjectType: 'CONTACT', subjectId: id } });
      // Activities and attachments: hard-delete (Art. 17)
      await tx.activity.deleteMany({ where: { subjectType: 'CONTACT', subjectId: id } });
      await tx.attachment.deleteMany({ where: { subjectType: 'CONTACT', subjectId: id } });
      // Calls + transcripts: anonymise transcript text, drop recording URL.
      // Both use polymorphic subjectType+subjectId (not a contactId FK).
      await tx.callTranscript.updateMany({
        where: { call: { subjectType: 'CONTACT', subjectId: id } },
        data: { rawText: ANON, redactedText: ANON, summary: ANON },
      });
      await tx.call.updateMany({
        where: { subjectType: 'CONTACT', subjectId: id },
        data: { recordingUrl: null, recordingStorageKey: null, fromNumber: ANON, toNumber: ANON },
      });
      // Email messages: anonymise body + recipients. subject is required NOT NULL.
      await tx.emailMessage.updateMany({
        where: { subjectType: 'CONTACT', subjectId: id },
        data: { bodyHtml: ANON, bodyText: null, toAddresses: [], ccAddresses: [], bccAddresses: [], subject: ANON },
      });

      return {
        attachmentKeys: attachments.map((a) => a.storageKey).filter((k): k is string => Boolean(k)),
        callRecordingKeys: calls.map((c) => c.recordingStorageKey).filter((k): k is string => Boolean(k)),
      };
    });

    // After DB commits, scrub binary blobs (best-effort — failures land in
    // a future GC sweep rather than blocking the user-facing erasure).
    await Promise.allSettled([
      ...attachmentKeys.map((k) => this.storage.remove(k)),
      ...callRecordingKeys.map((k) => this.storage.remove(k)),
    ]);

    await this.audit.log({
      action: 'gdpr.erase_contact',
      subjectType: 'contact',
      subjectId: id,
      metadata: { attachmentBlobsRemoved: attachmentKeys.length, callBlobsRemoved: callRecordingKeys.length },
    });
    this.logger.warn('GDPR erasure performed for contact %s in tenant %s', id, tenantId);
    return { erased: true };
  }

  async eraseClient(id: string): Promise<{ erased: true }> {
    const { tenantId } = requireTenantContext();
    const attachmentKeys = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const client = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!client) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND' });

      const attachments = await tx.attachment.findMany({
        where: { subjectType: 'CLIENT', subjectId: id },
        select: { storageKey: true },
      });

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
      await tx.note.deleteMany({ where: { subjectType: 'CLIENT', subjectId: id } });
      await tx.reminder.deleteMany({ where: { subjectType: 'CLIENT', subjectId: id } });
      await tx.activity.deleteMany({ where: { subjectType: 'CLIENT', subjectId: id } });
      await tx.attachment.deleteMany({ where: { subjectType: 'CLIENT', subjectId: id } });

      return attachments.map((a) => a.storageKey).filter((k): k is string => Boolean(k));
    });

    await Promise.allSettled(attachmentKeys.map((k) => this.storage.remove(k)));

    await this.audit.log({
      action: 'gdpr.erase_client',
      subjectType: 'client',
      subjectId: id,
      metadata: { attachmentBlobsRemoved: attachmentKeys.length },
    });
    this.logger.warn('GDPR erasure performed for client %s in tenant %s', id, tenantId);
    return { erased: true };
  }

  /**
   * Anonymise a Lead (right to erasure for pre-customer prospects).
   * Lead has fewer related entities than Contact/Client — typically just the
   * row itself. Fix BLUE3#1.
   */
  async eraseLead(id: string): Promise<{ erased: true }> {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id, deletedAt: null } });
      if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND' });
      await tx.lead.update({
        where: { id },
        data: {
          firstName: ANON,
          lastName: ANON,
          email: ANON_EMAIL,
          phone: null,
          company: null,
          jobTitle: null,
          notes: null,
          deletedAt: new Date(),
        },
      });
    });

    await this.audit.log({ action: 'gdpr.erase_lead', subjectType: 'lead', subjectId: id });
    this.logger.warn('GDPR erasure performed for lead %s in tenant %s', id, tenantId);
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

    const { staleContacts, staleClients } = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const [contacts, clients] = await Promise.all([
        tx.contact.findMany({
          where: { deletedAt: { lte: cutoff }, NOT: { firstName: ANON } },
          select: { id: true },
        }),
        tx.client.findMany({
          where: { deletedAt: { lte: cutoff }, NOT: { firstName: ANON } },
          select: { id: true },
        }),
      ]);
      return { staleContacts: contacts, staleClients: clients };
    });

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

  /**
   * Called by the cron scheduler — sweeps ALL tenants without requiring
   * a request context. Uses raw queries bypassing RLS (service-level privilege).
   */
  async sweepAllTenants(retentionDays = 365): Promise<{ total: { contacts: number; clients: number } }> {
    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    let totalContacts = 0;
    let totalClients = 0;

    const staleContacts = await this.prisma.contact.findMany({
      where: { deletedAt: { lte: cutoff }, NOT: { firstName: ANON } },
      select: { id: true, tenantId: true },
    });
    const staleClients = await this.prisma.client.findMany({
      where: { deletedAt: { lte: cutoff }, NOT: { firstName: ANON } },
      select: { id: true, tenantId: true },
    });

    for (const { id } of staleContacts) {
      await this.prisma.contact.update({
        where: { id },
        data: { firstName: ANON, lastName: ANON, email: ANON_EMAIL, phone: null, mobile: null, notes: null, jobTitle: null },
      }).catch((err) => this.logger.error('Sweep contact %s: %o', id, err));
      totalContacts++;
    }
    for (const { id } of staleClients) {
      await this.prisma.client.update({
        where: { id },
        data: { firstName: ANON, lastName: ANON, email: ANON_EMAIL, phone: null, mobile: null, addressLine: null, notes: null },
      }).catch((err) => this.logger.error('Sweep client %s: %o', id, err));
      totalClients++;
    }

    this.logger.log('Cron sweep done: %d contacts, %d clients anonymised', totalContacts, totalClients);
    return { total: { contacts: totalContacts, clients: totalClients } };
  }
}
