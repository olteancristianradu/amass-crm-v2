/**
 * MaintenanceScheduler — periodic background jobs.
 *
 * Jobs:
 *   retentionSweep  — daily at 02:00 UTC. Anonymises contacts/clients
 *                     that have been soft-deleted for > 365 days (configurable).
 *
 * The actual sweep logic lives in GdprService.sweepAllTenants() because it
 * needs direct DB access without a per-request tenant context.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CasesService } from '../../modules/cases/cases.service';
import { GdprService } from '../../modules/gdpr/gdpr.service';
import { InvoicesService } from '../../modules/invoices/invoices.service';
import { AuditService } from '../../modules/audit/audit.service';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MaintenanceScheduler {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    private readonly gdpr: GdprService,
    private readonly invoices: InvoicesService,
    private readonly cases: CasesService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Run every day at 02:00 UTC */
  @Cron('0 2 * * *', { name: 'gdpr-retention-sweep', timeZone: 'UTC' })
  async handleRetentionSweep(): Promise<void> {
    this.logger.log('Starting daily GDPR retention sweep…');
    try {
      const result = await this.gdpr.sweepAllTenants(365);
      this.logger.log('GDPR sweep complete: %o', result.total);
    } catch (err) {
      this.logger.error('GDPR retention sweep failed: %o', err);
    }
  }

  /** Flip ISSUED → OVERDUE for past-due invoices. Every hour. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'invoices-mark-overdue', timeZone: 'UTC' })
  async handleInvoiceOverdueSweep(): Promise<void> {
    try {
      const count = await this.invoices.markOverdueForAllTenants();
      if (count > 0) this.logger.log(`Marked ${count} invoice(s) as OVERDUE`);
    } catch (err) {
      this.logger.error('Invoice overdue sweep failed: %o', err);
    }
  }

  /** Bump priority on cases whose SLA deadline has passed. Every 15 minutes. */
  @Cron('*/15 * * * *', { name: 'cases-sla-escalation', timeZone: 'UTC' })
  async handleCaseSlaEscalation(): Promise<void> {
    try {
      const count = await this.cases.escalateOverdueForAllTenants();
      if (count > 0) this.logger.log(`SLA-escalated ${count} case(s)`);
    } catch (err) {
      this.logger.error('Case SLA escalation failed: %o', err);
    }
  }

  /**
   * E-compliance: prune audit logs older than the configured retention
   * window. Runs daily at 03:30 UTC — right after the GDPR sweep so the two
   * sweeps don't overlap on IO. Per-tenant retention overrides are read from
   * the tenant row; unset tenants fall back to AUDIT_RETENTION_DAYS_DEFAULT.
   */
  @Cron('30 3 * * *', { name: 'audit-retention-sweep', timeZone: 'UTC' })
  async handleAuditRetentionSweep(): Promise<void> {
    try {
      const env = loadEnv();
      // Iterate tenants so per-tenant overrides apply. When a tenant-specific
      // override is absent we use the env default. Tenant config for audit
      // retention lives in `tenants.metadata.auditRetentionDays` until we add
      // a first-class column — fall back gracefully.
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true, auditRetentionDays: true },
      });
      let total = 0;
      for (const t of tenants) {
        const days = t.auditRetentionDays ?? env.AUDIT_RETENTION_DAYS_DEFAULT;
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const result = await this.prisma.auditLog.deleteMany({
          where: { tenantId: t.id, createdAt: { lt: cutoff } },
        });
        total += result.count;
      }
      // AuditService kept as a dep so future per-entry pruning (redaction,
      // hash-chain checks) can be plugged in without touching the scheduler.
      void this.audit;
      if (total > 0) this.logger.log(`Audit retention pruned ${total} row(s)`);
    } catch (err) {
      this.logger.error('Audit retention sweep failed: %o', err);
    }
  }
}
