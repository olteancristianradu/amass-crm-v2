import { describe, expect, it } from 'vitest';
import {
  buildActivityStats,
  buildCallStats,
  buildDealStats,
  mapFinancialRow,
} from './reports.helpers';

describe('buildDealStats', () => {
  it('normalises bigint counters + string decimals', () => {
    const stats = buildDealStats({
      total: 10n,
      open: 5n,
      won: 3n,
      lost: 2n,
      total_value: '15000.00',
      won_value: '5000.00',
    });
    expect(stats.total).toBe(10);
    expect(stats.totalValue).toBe(15000);
    expect(stats.wonValue).toBe(5000);
    expect(stats.avgDealValue).toBe(1500);
  });

  it('handles the empty-period case (zeros everywhere, avg = 0)', () => {
    expect(buildDealStats(undefined)).toEqual({
      total: 0,
      open: 0,
      won: 0,
      lost: 0,
      totalValue: 0,
      wonValue: 0,
      avgDealValue: 0,
    });
  });
});

describe('mapFinancialRow', () => {
  it('computes outstanding = issued − paid', () => {
    const row = mapFinancialRow({
      currency: 'RON',
      issued_total: '10000',
      overdue_total: '2500',
      paid_total: '7000',
      issued_count: 10n,
      overdue_count: 3n,
      paid_count: 7n,
    });
    expect(row.outstanding).toBe(3000);
    expect(row.issuedCount).toBe(10);
  });

  it('clamps outstanding at 0 when refunds/over-payments exceed issued', () => {
    const row = mapFinancialRow({
      currency: 'EUR',
      issued_total: '1000',
      overdue_total: '0',
      paid_total: '1500',
      issued_count: 1n,
      overdue_count: 0n,
      paid_count: 1n,
    });
    expect(row.outstanding).toBe(0);
  });

  it('treats null totals as 0', () => {
    const row = mapFinancialRow({
      currency: 'RON',
      issued_total: null,
      overdue_total: null,
      paid_total: null,
      issued_count: 0n,
      overdue_count: 0n,
      paid_count: 0n,
    });
    expect(row.issued).toBe(0);
    expect(row.paid).toBe(0);
    expect(row.outstanding).toBe(0);
  });
});

describe('buildActivityStats', () => {
  it('sums counts + maps byType', () => {
    const out = buildActivityStats([
      { action: 'company.created', count: 5n },
      { action: 'deal.won', count: 3n },
    ]);
    expect(out.total).toBe(8);
    expect(out.byType).toEqual([
      { type: 'company.created', count: 5 },
      { type: 'deal.won', count: 3 },
    ]);
  });
});

describe('buildCallStats', () => {
  it('computes avg duration only for completed calls', () => {
    const stats = buildCallStats({ total: 10n, completed: 4n, total_duration: 600n });
    expect(stats.avgDurationSec).toBe(150);
  });

  it('avoids division by zero when no calls completed', () => {
    const stats = buildCallStats({ total: 5n, completed: 0n, total_duration: 0n });
    expect(stats.avgDurationSec).toBe(0);
  });
});
