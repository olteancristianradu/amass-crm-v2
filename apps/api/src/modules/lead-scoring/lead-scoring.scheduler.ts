/**
 * LeadScoringScheduler — periodic recompute of lead scores per tenant.
 *
 * Without this, scores never refresh and the Leads list shows stale (often
 * zero) values. Triggered daily at 04:00 UTC — runs after GDPR + audit
 * sweeps so the system isn't doing every periodic job at the same minute.
 *
 * Implementation: enumerate active tenants, enqueue one `recompute-tenant`
 * BullMQ job per tenant. The lead-scoring processor handles concurrency
 * + retries; the scheduler is intentionally just a fan-out.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class LeadScoringScheduler {
  private readonly logger = new Logger(LeadScoringScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('lead-scoring') private readonly queue: Queue,
  ) {}

  /** Daily at 04:00 UTC. */
  @Cron('0 4 * * *', { name: 'lead-scoring-recompute', timeZone: 'UTC' })
  async handleDailyRecompute(): Promise<void> {
    this.logger.log('Starting daily lead score recompute fan-out…');
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      for (const t of tenants) {
        // jobId namespaces the enqueue so a re-trigger same-day idempotently
        // replaces the pending job instead of stacking duplicates.
        const jobId = `recompute-tenant:${t.id}:${new Date().toISOString().slice(0, 10)}`;
        await this.queue.add('recompute-tenant', { tenantId: t.id }, { jobId });
      }
      this.logger.log(`Enqueued lead-scoring recompute for ${tenants.length} tenant(s)`);
    } catch (err) {
      this.logger.error('Lead scoring daily fan-out failed: %o', err);
    }
  }
}
