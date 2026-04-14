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
import { GdprService } from '../../modules/gdpr/gdpr.service';

@Injectable()
export class MaintenanceScheduler {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(private readonly gdpr: GdprService) {}

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
}
