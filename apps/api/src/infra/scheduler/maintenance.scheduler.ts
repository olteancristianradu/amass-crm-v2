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

@Injectable()
export class MaintenanceScheduler {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    private readonly gdpr: GdprService,
    private readonly invoices: InvoicesService,
    private readonly cases: CasesService,
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
}
