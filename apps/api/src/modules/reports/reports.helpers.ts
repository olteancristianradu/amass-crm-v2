/**
 * Pure transformation helpers for ReportsService. The raw `$queryRaw`
 * results come back with bigint counters and string decimals (Postgres
 * numeric is serialised as string to avoid JS float loss). These helpers
 * normalise them into the DTOs the FE expects.
 */

export interface DealStatsRaw {
  total: bigint;
  open: bigint;
  won: bigint;
  lost: bigint;
  total_value: string | null;
  won_value: string | null;
}

export interface DealStats {
  total: number;
  open: number;
  won: number;
  lost: number;
  totalValue: number;
  wonValue: number;
  avgDealValue: number;
}

export function buildDealStats(r: DealStatsRaw | undefined): DealStats {
  const total = Number(r?.total ?? 0);
  const won = Number(r?.won ?? 0);
  const totalValue = parseFloat(r?.total_value ?? '0');
  const wonValue = parseFloat(r?.won_value ?? '0');
  return {
    total,
    open: Number(r?.open ?? 0),
    won,
    lost: Number(r?.lost ?? 0),
    totalValue,
    wonValue,
    avgDealValue: total > 0 ? totalValue / total : 0,
  };
}

export interface FinancialSummaryRaw {
  currency: string;
  issued_total: string | null;
  overdue_total: string | null;
  paid_total: string | null;
  issued_count: bigint;
  overdue_count: bigint;
  paid_count: bigint;
}

export interface FinancialSummaryItem {
  currency: string;
  issued: number;
  overdue: number;
  paid: number;
  outstanding: number;
  issuedCount: number;
  overdueCount: number;
  paidCount: number;
}

export function mapFinancialRow(r: FinancialSummaryRaw): FinancialSummaryItem {
  const issued = parseFloat(r.issued_total ?? '0');
  const paid = parseFloat(r.paid_total ?? '0');
  return {
    currency: r.currency,
    issued,
    overdue: parseFloat(r.overdue_total ?? '0'),
    paid,
    // `outstanding` cannot go below zero even if paid > issued due to
    // over-payments / refunds captured separately — clamp at 0.
    outstanding: Math.max(0, issued - paid),
    issuedCount: Number(r.issued_count),
    overdueCount: Number(r.overdue_count),
    paidCount: Number(r.paid_count),
  };
}

export interface ActivityCountRaw {
  action: string;
  count: bigint;
}

export function buildActivityStats(rows: ActivityCountRaw[]): { total: number; byType: { type: string; count: number }[] } {
  return {
    total: rows.reduce((acc, r) => acc + Number(r.count), 0),
    byType: rows.map((r) => ({ type: r.action, count: Number(r.count) })),
  };
}

export interface CallStatsRaw {
  total: bigint;
  completed: bigint;
  total_duration: bigint | null;
}

export function buildCallStats(r: CallStatsRaw | undefined): {
  total: number;
  completed: number;
  totalDurationSec: number;
  avgDurationSec: number;
} {
  const total = Number(r?.total ?? 0);
  const completed = Number(r?.completed ?? 0);
  const totalDurationSec = Number(r?.total_duration ?? 0);
  return {
    total,
    completed,
    totalDurationSec,
    avgDurationSec: completed > 0 ? totalDurationSec / completed : 0,
  };
}
