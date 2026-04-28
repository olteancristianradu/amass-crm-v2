/**
 * Lead Scoring — weighted signal formula:
 *   Activities (30%): 1pt each, capped at 30
 *   Calls (25%): 3pt each, capped at 25
 *   Email opens (20%): 2pt each from email_messages, capped at 20
 *   Deal pipeline value (25%): normalised deal value (0-25)
 *
 * Final score: 0–100. Stored in lead_scores with full factor breakdown.
 * A BullMQ repeating job recomputes all active entities nightly at 02:00.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export type LeadEntityType = 'company' | 'contact';

interface ScoreFactors {
  activities: number;
  calls: number;
  emailOpens: number;
  dealCount: number;
  dealValue: number;
  lastActivityDays: number;
}

@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('lead-scoring') private readonly queue: Queue,
  ) {}

  async getScore(entityType: LeadEntityType, entityId: string) {
    const { tenantId } = requireTenantContext();
    const score = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.leadScore.findFirst({ where: { tenantId, entityType, entityId } }),
    );
    if (!score) {
      // Compute on-demand if not yet scored
      return this.computeAndSave(tenantId, entityType, entityId);
    }
    return score;
  }

  async requestRecompute(entityType: LeadEntityType, entityId: string) {
    const { tenantId } = requireTenantContext();
    await this.queue.add('recompute-single', { tenantId, entityType, entityId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // M-aud-M10: bound retention so failed jobs don't pile up in Redis
      // (lead-scoring can fan-out a lot under bulk-import scenarios).
      removeOnComplete: { count: 100 },
      removeOnFail: { age: 86_400, count: 100 },
    });
    return { queued: true };
  }

  async recomputeAllForTenant(tenantId: string): Promise<number> {
    const [companies, contacts] = await Promise.all([
      this.prisma.runWithTenant(tenantId, (tx) =>
        tx.company.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      ),
      this.prisma.runWithTenant(tenantId, (tx) =>
        tx.contact.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      ),
    ]);

    let count = 0;
    for (const c of companies) {
      try {
        await this.computeAndSave(tenantId, 'company', c.id);
        count++;
      } catch (err) {
        this.logger.warn(`Failed to score company ${c.id}: ${String(err)}`);
      }
    }
    for (const c of contacts) {
      try {
        await this.computeAndSave(tenantId, 'contact', c.id);
        count++;
      } catch (err) {
        this.logger.warn(`Failed to score contact ${c.id}: ${String(err)}`);
      }
    }
    return count;
  }

  async computeAndSave(tenantId: string, entityType: LeadEntityType, entityId: string) {
    const factors = await this.gatherFactors(tenantId, entityType, entityId);
    const score = this.calculateScore(factors);

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.leadScore.upsert({
        where: { tenantId_entityType_entityId: { tenantId, entityType, entityId } },
        create: {
          tenantId,
          entityType,
          entityId,
          score,
          factors: factors as unknown as Prisma.JsonObject,
        },
        update: {
          score,
          factors: factors as unknown as Prisma.JsonObject,
          computedAt: new Date(),
        },
      }),
    );
  }

  private calculateScore(f: ScoreFactors): number {
    const activityPts = Math.min(f.activities, 30);        // 30%
    const callPts = Math.min(f.calls * 3, 25);             // 25%
    const emailPts = Math.min(f.emailOpens * 2, 20);       // 20%

    // Deal value score: normalise at 100k = full 25 pts, capped
    const dealValuePts = Math.min(Math.round((f.dealValue / 100_000) * 25), 25); // 25%

    // Recency decay: subtract up to 10 pts if last activity > 30 days ago
    const recencyPenalty = f.lastActivityDays > 30 ? Math.min(Math.round((f.lastActivityDays - 30) / 3), 10) : 0;

    return Math.max(0, activityPts + callPts + emailPts + dealValuePts - recencyPenalty);
  }

  private async gatherFactors(tenantId: string, entityType: LeadEntityType, entityId: string): Promise<ScoreFactors> {
    const companyId = entityType === 'company' ? entityId : null;
    const contactId = entityType === 'contact' ? entityId : null;

    // Verify entity exists
    if (companyId) {
      const exists = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.company.findFirst({ where: { id: companyId, tenantId, deletedAt: null }, select: { id: true } }),
      );
      if (!exists) throw new NotFoundException('Company not found');
    } else {
      const exists = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.contact.findFirst({ where: { id: contactId!, tenantId, deletedAt: null }, select: { id: true } }),
      );
      if (!exists) throw new NotFoundException('Contact not found');
    }

    const [activities, calls, emailMessages, deals] = await Promise.all([
      this.prisma.runWithTenant(tenantId, (tx) =>
        tx.activity.count({
          where: {
            tenantId,
            ...(companyId ? { subjectType: 'COMPANY', subjectId: companyId } : { subjectType: 'CONTACT', subjectId: contactId! }),
          },
        }),
      ),
      this.prisma.runWithTenant(tenantId, (tx) =>
        tx.call.count({
          where: {
            tenantId,
            ...(companyId ? { subjectType: 'COMPANY', subjectId: companyId } : { subjectType: 'CONTACT', subjectId: contactId! }),
          },
        }),
      ),
      // Count email threads linked to entity (via contactId)
      contactId
        ? this.prisma.runWithTenant(tenantId, (tx) =>
          tx.emailMessage.count({ where: { tenantId, contactId: contactId } }),
        )
        : Promise.resolve(0),
      // Deals linked to company/contact
      this.prisma.runWithTenant(tenantId, (tx) =>
        tx.deal.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(companyId ? { companyId } : { contactId: contactId! }),
          },
          select: { value: true },
        }),
      ),
    ]);

    // Last activity date for recency
    const lastActivity = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.activity.findFirst({
        where: {
          tenantId,
          ...(companyId ? { subjectType: 'COMPANY', subjectId: companyId } : { subjectType: 'CONTACT', subjectId: contactId! }),
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    );

    const lastActivityDays = lastActivity
      ? Math.floor((Date.now() - lastActivity.createdAt.getTime()) / 86400000)
      : 999;

    const dealValue = deals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);

    return {
      activities,
      calls,
      emailOpens: emailMessages,
      dealCount: deals.length,
      dealValue,
      lastActivityDays,
    };
  }
}
