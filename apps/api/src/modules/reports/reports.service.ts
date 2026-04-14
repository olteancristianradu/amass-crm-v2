/**
 * ReportsService — aggregated business metrics for the reporting dashboard.
 *
 * All queries run via $queryRaw / $queryRawUnsafe so we can use Postgres
 * aggregate functions, date_trunc, and window functions that Prisma ORM
 * doesn't expose directly. Every query is parameterised to prevent injection.
 *
 * Date filtering: `from` + `to` are inclusive ISO date strings (YYYY-MM-DD).
 * All timestamps are stored as UTC in Postgres so comparisons are exact.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface DealStats {
  total: number;
  open: number;
  won: number;
  lost: number;
  totalValue: number;    // sum of value for all deals
  wonValue: number;      // sum of value for WON deals
  avgDealValue: number;
}

export interface PipelineStageStats {
  stageId: string;
  stageName: string;
  count: number;
  totalValue: number;
}

export interface ActivityStats {
  total: number;
  byType: { type: string; count: number }[];
}

export interface EmailStats {
  sent: number;
  failed: number;
  queued: number;
}

export interface CallStats {
  total: number;
  completed: number;
  totalDurationSec: number;
  avgDurationSec: number;
}

export interface DashboardStats {
  deals: DealStats;
  pipeline: PipelineStageStats[];
  activities: ActivityStats;
  emails: EmailStats;
  calls: CallStats;
  period: { from: string; to: string };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(from: string, to: string): Promise<DashboardStats> {
    const { tenantId } = requireTenantContext();

    const [dealStats, pipeline, activityStats, emailStats, callStats] = await Promise.all([
      this.getDealStats(tenantId, from, to),
      this.getPipelineStats(tenantId, from, to),
      this.getActivityStats(tenantId, from, to),
      this.getEmailStats(tenantId, from, to),
      this.getCallStats(tenantId, from, to),
    ]);

    return { deals: dealStats, pipeline, activities: activityStats, emails: emailStats, calls: callStats, period: { from, to } };
  }

  private async getDealStats(tenantId: string, from: string, to: string): Promise<DealStats> {
    const rows = await this.prisma.$queryRaw<Array<{
      total: bigint; open: bigint; won: bigint; lost: bigint;
      total_value: string | null; won_value: string | null;
    }>>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'OPEN')  AS open,
        COUNT(*) FILTER (WHERE status = 'WON')   AS won,
        COUNT(*) FILTER (WHERE status = 'LOST')  AS lost,
        SUM(value)                               AS total_value,
        SUM(value) FILTER (WHERE status = 'WON') AS won_value
      FROM deals
      WHERE tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
        AND created_at >= ${from}::date
        AND created_at <= ${to}::date + INTERVAL '1 day'
    `;
    const r = rows[0];
    const total = Number(r.total ?? 0);
    const won = Number(r.won ?? 0);
    const totalValue = parseFloat(r.total_value ?? '0');
    const wonValue = parseFloat(r.won_value ?? '0');
    return {
      total,
      open: Number(r.open ?? 0),
      won,
      lost: Number(r.lost ?? 0),
      totalValue,
      wonValue,
      avgDealValue: total > 0 ? totalValue / total : 0,
    };
  }

  private async getPipelineStats(tenantId: string, from: string, to: string): Promise<PipelineStageStats[]> {
    return this.prisma.$queryRaw<PipelineStageStats[]>`
      SELECT
        d.stage_id     AS "stageId",
        ps.name        AS "stageName",
        COUNT(*)       AS count,
        COALESCE(SUM(d.value), 0) AS "totalValue"
      FROM deals d
      JOIN pipeline_stages ps ON ps.id = d.stage_id
      WHERE d.tenant_id   = ${tenantId}
        AND d.deleted_at  IS NULL
        AND d.created_at >= ${from}::date
        AND d.created_at <= ${to}::date + INTERVAL '1 day'
      GROUP BY d.stage_id, ps.name
      ORDER BY COUNT(*) DESC
    `;
  }

  private async getActivityStats(tenantId: string, from: string, to: string): Promise<ActivityStats> {
    const rows = await this.prisma.$queryRaw<Array<{ action: string; count: bigint }>>`
      SELECT action, COUNT(*) AS count
      FROM activities
      WHERE tenant_id   = ${tenantId}
        AND created_at >= ${from}::date
        AND created_at <= ${to}::date + INTERVAL '1 day'
      GROUP BY action
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `;
    const total = rows.reduce((acc, r) => acc + Number(r.count), 0);
    return {
      total,
      byType: rows.map((r) => ({ type: r.action, count: Number(r.count) })),
    };
  }

  private async getEmailStats(tenantId: string, from: string, to: string): Promise<EmailStats> {
    const rows = await this.prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*) AS count
      FROM email_messages
      WHERE tenant_id   = ${tenantId}
        AND created_at >= ${from}::date
        AND created_at <= ${to}::date + INTERVAL '1 day'
      GROUP BY status
    `;
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    return {
      sent: byStatus['SENT'] ?? 0,
      failed: byStatus['FAILED'] ?? 0,
      queued: (byStatus['QUEUED'] ?? 0) + (byStatus['SENDING'] ?? 0),
    };
  }

  private async getCallStats(tenantId: string, from: string, to: string): Promise<CallStats> {
    const rows = await this.prisma.$queryRaw<Array<{
      total: bigint; completed: bigint;
      total_duration: bigint | null;
    }>>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        SUM(duration_sec)                             AS total_duration
      FROM calls
      WHERE tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
        AND created_at >= ${from}::date
        AND created_at <= ${to}::date + INTERVAL '1 day'
    `;
    const r = rows[0];
    const total = Number(r.total ?? 0);
    const completed = Number(r.completed ?? 0);
    const totalDurationSec = Number(r.total_duration ?? 0);
    return {
      total,
      completed,
      totalDurationSec,
      avgDurationSec: completed > 0 ? totalDurationSec / completed : 0,
    };
  }

  /** Deals grouped by week for a trend chart */
  async dealsTrend(from: string, to: string): Promise<{ week: string; created: number; won: number; revenue: number }[]> {
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.$queryRaw<Array<{
      week: Date; created: bigint; won: bigint; revenue: string | null;
    }>>`
      SELECT
        date_trunc('week', created_at)                AS week,
        COUNT(*)                                      AS created,
        COUNT(*) FILTER (WHERE status = 'WON')        AS won,
        SUM(value) FILTER (WHERE status = 'WON')      AS revenue
      FROM deals
      WHERE tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
        AND created_at >= ${from}::date
        AND created_at <= ${to}::date + INTERVAL '1 day'
      GROUP BY week
      ORDER BY week ASC
    `;
    return rows.map((r) => ({
      week: r.week.toISOString().slice(0, 10),
      created: Number(r.created),
      won: Number(r.won),
      revenue: parseFloat(r.revenue ?? '0'),
    }));
  }
}
