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
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
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
      WHERE "tenantId"   = ${tenantId}
        AND "deletedAt"  IS NULL
        AND "createdAt" >= ${from}::date
        AND "createdAt" <= ${to}::date + INTERVAL '1 day'
    `);
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
    // Postgres returns COUNT(*) as bigint and SUM(numeric) as string; both
    // crash JSON.stringify with "Do not know how to serialize a BigInt"
    // unless coerced. Type the row narrowly and convert before returning.
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
      stageId: string; stageName: string; count: bigint; totalValue: string | null;
    }>>`
      SELECT
        d."stageId"    AS "stageId",
        ps.name        AS "stageName",
        COUNT(*)       AS count,
        COALESCE(SUM(d.value), 0) AS "totalValue"
      FROM deals d
      JOIN pipeline_stages ps ON ps.id = d."stageId"
      WHERE d."tenantId"   = ${tenantId}
        AND d."deletedAt"  IS NULL
        AND d."createdAt" >= ${from}::date
        AND d."createdAt" <= ${to}::date + INTERVAL '1 day'
      GROUP BY d."stageId", ps.name
      ORDER BY COUNT(*) DESC
    `);
    return rows.map((r) => ({
      stageId: r.stageId,
      stageName: r.stageName,
      count: Number(r.count),
      totalValue: parseFloat(r.totalValue ?? '0'),
    }));
  }

  private async getActivityStats(tenantId: string, from: string, to: string): Promise<ActivityStats> {
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{ action: string; count: bigint }>>`
      SELECT action, COUNT(*) AS count
      FROM activities
      WHERE "tenantId"   = ${tenantId}
        AND "createdAt" >= ${from}::date
        AND "createdAt" <= ${to}::date + INTERVAL '1 day'
      GROUP BY action
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);
    const total = rows.reduce((acc, r) => acc + Number(r.count), 0);
    return {
      total,
      byType: rows.map((r) => ({ type: r.action, count: Number(r.count) })),
    };
  }

  private async getEmailStats(tenantId: string, from: string, to: string): Promise<EmailStats> {
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*) AS count
      FROM email_messages
      WHERE "tenantId"   = ${tenantId}
        AND "createdAt" >= ${from}::date
        AND "createdAt" <= ${to}::date + INTERVAL '1 day'
      GROUP BY status
    `);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    return {
      sent: byStatus['SENT'] ?? 0,
      failed: byStatus['FAILED'] ?? 0,
      queued: (byStatus['QUEUED'] ?? 0) + (byStatus['SENDING'] ?? 0),
    };
  }

  private async getCallStats(tenantId: string, from: string, to: string): Promise<CallStats> {
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
      total: bigint; completed: bigint;
      total_duration: bigint | null;
    }>>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        SUM("durationSec")                            AS total_duration
      FROM calls
      WHERE "tenantId"   = ${tenantId}
        AND "deletedAt"  IS NULL
        AND "createdAt" >= ${from}::date
        AND "createdAt" <= ${to}::date + INTERVAL '1 day'
    `);
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
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
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
    `);
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
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
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
    `);
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
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
      period: Date; created: bigint; won: bigint; revenue: string | null;
    }>>`
      SELECT
        date_trunc(${groupBy}, "createdAt")           AS period,
        COUNT(*)                                      AS created,
        COUNT(*) FILTER (WHERE status = 'WON')        AS won,
        SUM(value) FILTER (WHERE status = 'WON')      AS revenue
      FROM deals
      WHERE "tenantId"   = ${tenantId}
        AND "deletedAt"  IS NULL
        AND "createdAt" >= ${from}::date
        AND "createdAt" <= ${to}::date + INTERVAL '1 day'
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((r) => ({
      period: r.period.toISOString().slice(0, 10),
      created: Number(r.created),
      won: Number(r.won),
      revenue: parseFloat(r.revenue ?? '0'),
    }));
  }

  /**
   * Desfășurător zilnic apeluri per agent. Returnează un array de apeluri
   * pentru ziua dată, fiecare cu durata MM:SS + numele/numărul interlocutorului.
   *
   * Pe `userId=undefined` întoarce toate apelurile zilei pentru tenantul
   * curent (admin/manager view). Pe userId specificat — doar apelurile
   * agentului ăluia.
   */
  async agentCalls(
    day: string,
    userId?: string,
  ): Promise<{
    date: string;
    totalCalls: number;
    totalDurationSec: number;
    totalDurationFmt: string;
    items: Array<{
      callId: string;
      agentId: string | null;
      agentName: string | null;
      contactName: string | null;
      phone: string;
      direction: 'INBOUND' | 'OUTBOUND';
      status: string;
      startedAt: string | null;
      durationSec: number;
      durationFmt: string;
      subjectType: string;
      subjectId: string;
    }>;
  }> {
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.runWithTenant(tenantId, 'ro', (tx) => tx.$queryRaw<Array<{
      call_id: string;
      agent_id: string | null;
      agent_name: string | null;
      contact_name: string | null;
      to_number: string;
      from_number: string;
      direction: 'INBOUND' | 'OUTBOUND';
      status: string;
      started_at: Date | null;
      duration_sec: number | null;
      subject_type: string;
      subject_id: string;
    }>>`
      SELECT
        c.id                                                          AS call_id,
        c."userId"                                                    AS agent_id,
        u."fullName"                                                  AS agent_name,
        COALESCE(
          (CASE WHEN c."subjectType" = 'CONTACT' THEN
              (SELECT (ct."firstName" || ' ' || ct."lastName")
               FROM contacts ct WHERE ct.id = c."subjectId" AND ct."tenantId" = ${tenantId})
            END),
          (CASE WHEN c."subjectType" = 'CLIENT' THEN
              (SELECT (cl."firstName" || ' ' || cl."lastName")
               FROM clients cl WHERE cl.id = c."subjectId" AND cl."tenantId" = ${tenantId})
            END),
          (CASE WHEN c."subjectType" = 'COMPANY' THEN
              (SELECT co."name" FROM companies co WHERE co.id = c."subjectId" AND co."tenantId" = ${tenantId})
            END)
        )                                                             AS contact_name,
        c."toNumber"                                                  AS to_number,
        c."fromNumber"                                                AS from_number,
        c.direction                                                   AS direction,
        c.status::text                                                AS status,
        c."startedAt"                                                 AS started_at,
        c."durationSec"                                               AS duration_sec,
        c."subjectType"::text                                         AS subject_type,
        c."subjectId"                                                 AS subject_id
      FROM calls c
      LEFT JOIN users u ON u.id = c."userId"
      WHERE c."tenantId" = ${tenantId}
        AND c."deletedAt" IS NULL
        AND c."createdAt" >= ${day}::date
        AND c."createdAt" <  ${day}::date + INTERVAL '1 day'
        AND (${userId ?? null}::text IS NULL OR c."userId" = ${userId ?? null}::text)
      ORDER BY c."startedAt" ASC NULLS LAST, c."createdAt" ASC
    `);

    const fmt = (s: number): string => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    let totalDuration = 0;
    const items = rows.map((r) => {
      const dur = r.duration_sec ?? 0;
      totalDuration += dur;
      const counterpartyPhone = r.direction === 'OUTBOUND' ? r.to_number : r.from_number;
      return {
        callId: r.call_id,
        agentId: r.agent_id,
        agentName: r.agent_name,
        contactName: r.contact_name && r.contact_name.trim() ? r.contact_name.trim() : null,
        phone: counterpartyPhone,
        direction: r.direction,
        status: r.status,
        startedAt: r.started_at ? r.started_at.toISOString() : null,
        durationSec: dur,
        durationFmt: fmt(dur),
        subjectType: r.subject_type,
        subjectId: r.subject_id,
      };
    });

    return {
      date: day,
      totalCalls: items.length,
      totalDurationSec: totalDuration,
      totalDurationFmt: fmt(totalDuration),
      items,
    };
  }
}
