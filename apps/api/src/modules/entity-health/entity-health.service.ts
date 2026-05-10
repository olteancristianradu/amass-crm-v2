import { Injectable } from '@nestjs/common';
import { SubjectType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * RelationshipHealthService — deterministic 0-100 health score for a
 * Company / Contact / Client. Pure read-side; no AI calls (yet).
 *
 * Score weighted average of 4 signals:
 *   • Recency (40%)        — how recent was the last activity?
 *   • Frequency (25%)      — how many touchpoints in the last 90 days?
 *   • Deal momentum (20%)  — best stage-probability of any open deal
 *   • Engagement (15%)     — note + reminder + task count over 30 days
 *
 * The "summary" field is a deterministic, human-readable string built
 * from the same signals. We deliberately avoid LLM calls on this hot
 * path — the AI summary is opt-in via /entity-health/:type/:id/summary
 * (placeholder; future work).
 */

export interface HealthSignal {
  key: 'recency' | 'frequency' | 'deal_momentum' | 'engagement';
  score: number; // 0-100
  weight: number; // 0-1, sums to 1.0 across all signals
  label: string; // RO label
  hint: string; // why this score
}

export interface RelationshipHealth {
  score: number; // 0-100, weighted average
  rating: 'excellent' | 'good' | 'fair' | 'at_risk' | 'cold';
  signals: HealthSignal[];
  summary: string;
  lastActivityAt: string | null;
  activityCount90d: number;
  openDealCount: number;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class EntityHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(
    entityType: SubjectType,
    entityId: string,
  ): Promise<RelationshipHealth> {
    const { tenantId } = requireTenantContext();
    const now = Date.now();
    const ninetyAgo = new Date(now - NINETY_DAYS_MS);
    const thirtyAgo = new Date(now - THIRTY_DAYS_MS);

    return this.prisma.runWithTenant(tenantId, 'ro', async (tx) => {
      const [activities, deals, recentReminders] = await Promise.all([
        tx.activity.findMany({
          where: { tenantId, subjectType: entityType, subjectId: entityId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { createdAt: true, action: true },
        }),
        // Deal momentum only applies to COMPANY/CONTACT entities (B2B).
        entityType === 'COMPANY'
          ? tx.deal.findMany({
              where: { tenantId, companyId: entityId, deletedAt: null, status: 'OPEN' },
              select: {
                stage: { select: { probability: true } },
                probability: true,
                value: true,
              },
            })
          : entityType === 'CONTACT'
            ? tx.deal.findMany({
                where: { tenantId, contactId: entityId, deletedAt: null, status: 'OPEN' },
                select: {
                  stage: { select: { probability: true } },
                  probability: true,
                  value: true,
                },
              })
            : Promise.resolve([] as { stage: { probability: number }; probability: number | null; value: unknown }[]),
        tx.reminder.count({
          where: {
            tenantId,
            subjectType: entityType,
            subjectId: entityId,
            createdAt: { gte: thirtyAgo },
          },
        }),
      ]);

      const lastActivity = activities[0] ?? null;
      const activityCount90d = activities.filter((a) => a.createdAt >= ninetyAgo).length;
      const activityCount30d = activities.filter((a) => a.createdAt >= thirtyAgo).length;

      // ── Signal: recency (40%) ───────────────────────────────────────
      const daysSince = lastActivity
        ? Math.floor((now - lastActivity.createdAt.getTime()) / (24 * 60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
      const recencyScore =
        daysSince <= 7 ? 100
          : daysSince <= 30 ? 80
            : daysSince <= 90 ? 50
              : daysSince <= 180 ? 20
                : 0;
      const recencyHint = lastActivity
        ? `Ultima interacțiune acum ${daysSince} ${daysSince === 1 ? 'zi' : 'zile'}.`
        : 'Nicio interacțiune înregistrată.';

      // ── Signal: frequency (25%) ─────────────────────────────────────
      // Linear: 0 events → 0, 10+ events in 90d → 100.
      const frequencyScore = Math.min(100, activityCount90d * 10);
      const frequencyHint = `${activityCount90d} ${activityCount90d === 1 ? 'eveniment' : 'evenimente'} în ultimele 90 de zile.`;

      // ── Signal: deal momentum (20%) ────────────────────────────────
      const bestProb = deals.length
        ? Math.max(0, ...deals.map((d) => d.probability ?? d.stage?.probability ?? 0))
        : 0;
      const dealMomentumScore = deals.length === 0 ? 50 : bestProb;
      const dealMomentumHint =
        deals.length === 0
          ? entityType === 'CLIENT'
            ? 'Clienții B2C nu au deal-uri asociate (neutral).'
            : 'Niciun deal deschis.'
            : `${deals.length} deal${deals.length === 1 ? '' : '-uri'} deschise, cea mai bună probabilitate ${bestProb}%.`;

      // ── Signal: engagement (15%) ───────────────────────────────────
      const engagementScore = Math.min(100, (activityCount30d * 15) + (recentReminders * 25));
      const engagementHint = `${activityCount30d} acțiuni + ${recentReminders} reminder${recentReminders === 1 ? '' : '-uri'} ultimele 30 de zile.`;

      const signals: HealthSignal[] = [
        { key: 'recency', score: recencyScore, weight: 0.4, label: 'Recență', hint: recencyHint },
        { key: 'frequency', score: frequencyScore, weight: 0.25, label: 'Frecvență', hint: frequencyHint },
        { key: 'deal_momentum', score: dealMomentumScore, weight: 0.2, label: 'Pipeline', hint: dealMomentumHint },
        { key: 'engagement', score: engagementScore, weight: 0.15, label: 'Implicare', hint: engagementHint },
      ];

      const score = Math.round(
        signals.reduce((acc, s) => acc + s.score * s.weight, 0),
      );

      return {
        score,
        rating: rateScore(score),
        signals,
        summary: buildSummary(score, daysSince, activityCount90d, deals.length, bestProb),
        lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
        activityCount90d,
        openDealCount: deals.length,
      };
    });
  }
}

function rateScore(score: number): RelationshipHealth['rating'] {
  if (score >= 85) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  if (score >= 25) return 'at_risk';
  return 'cold';
}

function buildSummary(
  score: number,
  daysSince: number,
  count90d: number,
  openDeals: number,
  bestProb: number,
): string {
  const parts: string[] = [];
  if (score >= 85) {
    parts.push('Relație foarte bună');
  } else if (score >= 65) {
    parts.push('Relație sănătoasă');
  } else if (score >= 45) {
    parts.push('Relație constantă');
  } else if (score >= 25) {
    parts.push('Atenție — relația slăbește');
  } else {
    parts.push('Relație rece, necesită follow-up');
  }
  if (Number.isFinite(daysSince)) {
    parts.push(`ultima interacțiune acum ${daysSince} ${daysSince === 1 ? 'zi' : 'zile'}`);
  } else {
    parts.push('fără interacțiuni înregistrate');
  }
  if (count90d > 0) {
    parts.push(`${count90d} ${count90d === 1 ? 'eveniment' : 'evenimente'} în 90 de zile`);
  }
  if (openDeals > 0) {
    parts.push(`${openDeals} deal${openDeals === 1 ? '' : '-uri'} deschise (${bestProb}% best)`);
  }
  return `${parts[0]} — ${parts.slice(1).join(', ')}.`;
}
