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

  /**
   * S25 Financial summary — invoice-centric totals for the period.
   * Grouped by currency because a tenant may issue both RON + EUR.
   */
  async financialSummary(
    from: string,
    to: string,
  ): Promise<{
    currency: string;
    issued: number;
    overdue: number;
    paid: number;
    outstanding: number;
    issuedCount: number;
    overdueCount: number;
    paidCount: number;
  }[]> {
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.$queryRaw<Array<{
      currency: string;
      issued_total: string | null;
      overdue_total: string | null;
      paid_total: string | null;
      issued_count: bigint;
      overdue_count: bigint;
      paid_count: bigint;
    }>>`
      SELECT
        currency,
        SUM(total) FILTER (WHERE status NOT IN ('DRAFT', 'CANCELLED'))     AS issued_total,
        SUM(total) FILTER (WHERE status = 'OVERDUE')                        AS overdue_total,
        SUM(total) FILTER (WHERE status = 'PAID')                           AS paid_total,
        COUNT(*) FILTER (WHERE status NOT IN ('DRAFT', 'CANCELLED'))        AS issued_count,
        COUNT(*) FILTER (WHERE status = 'OVERDUE')                          AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'PAID')                             AS paid_count
      FROM invoices
      WHERE tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
        AND issue_date >= ${from}::date
        AND issue_date <= ${to}::date + INTERVAL '1 day'
      GROUP BY currency
      ORDER BY currency ASC
    `;
    return rows.map((r) => {
      const issued = parseFloat(r.issued_total ?? '0');
      const paid = parseFloat(r.paid_total ?? '0');
      return {
        currency: r.currency,
        issued,
        overdue: parseFloat(r.overdue_total ?? '0'),
        paid,
        outstanding: Math.max(0, issued - paid),
        issuedCount: Number(r.issued_count),
        overdueCount: Number(r.overdue_count),
        paidCount: Number(r.paid_count),
      };
    });
  }

  /** Revenue (paid invoices) grouped by month + currency for the trend chart. */
  async revenueTrend(
    from: string,
    to: string,
  ): Promise<{ month: string; currency: string; revenue: number }[]> {
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.$queryRaw<Array<{
      month: Date;
      currency: string;
      revenue: string | null;
    }>>`
      SELECT
        date_trunc('month', issue_date)::date AS month,
        currency,
        SUM(total) FILTER (WHERE status = 'PAID') AS revenue
      FROM invoices
      WHERE tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
        AND issue_date >= ${from}::date
        AND issue_date <= ${to}::date + INTERVAL '1 day'
      GROUP BY month, currency
      ORDER BY month ASC
    `;
    return rows.map((r) => ({
      month: r.month.toISOString().slice(0, 10),
      currency: r.currency,
      revenue: parseFloat(r.revenue ?? '0'),
    }));
  }

  /** Deals grouped by week or month for a trend chart */
  async dealsTrend(
    from: string,
    to: string,
    groupBy: 'week' | 'month' = 'week',
  ): Promise<{ period: string; created: number; won: number; revenue: number }[]> {
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.$queryRaw<Array<{
      period: Date; created: bigint; won: bigint; revenue: string | null;
    }>>`
      SELECT
        date_trunc(${groupBy}, created_at)            AS period,
        COUNT(*)                                      AS created,
        COUNT(*) FILTER (WHERE status = 'WON')        AS won,
        SUM(value) FILTER (WHERE status = 'WON')      AS revenue
      FROM deals
      WHERE tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
        AND created_at >= ${from}::date
        AND created_at <= ${to}::date + INTERVAL '1 day'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      period: r.period.toISOString().slice(0, 10),
      created: Number(r.created),
      won: Number(r.won),
      revenue: parseFloat(r.revenue ?? '0'),
    }));
  }
}
