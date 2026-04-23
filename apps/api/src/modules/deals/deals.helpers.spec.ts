import { describe, expect, it } from 'vitest';
import type { ForecastDeal } from './deals.helpers';
import { aggregateForecast, stageTypeToStatus } from './deals.helpers';

describe('stageTypeToStatus', () => {
  it('maps OPEN stage → OPEN status', () => {
    expect(stageTypeToStatus('OPEN')).toBe('OPEN');
  });
  it('maps WON → WON', () => {
    expect(stageTypeToStatus('WON')).toBe('WON');
  });
  it('maps LOST → LOST', () => {
    expect(stageTypeToStatus('LOST')).toBe('LOST');
  });
});

describe('aggregateForecast', () => {
  const mkDeal = (overrides: Partial<ForecastDeal> = {}): ForecastDeal => ({
    id: 'd1',
    title: 'Deal 1',
    value: 1000,
    currency: 'RON',
    probability: null,
    stageId: 'stage-1',
    stage: { id: 'stage-1', name: 'Negotiation', probability: 50 },
    ...overrides,
  });

  it('returns empty buckets + zero totals for empty input', () => {
    expect(aggregateForecast([])).toEqual({ stages: [], totalRaw: 0, totalWeighted: 0 });
  });

  it('uses deal probability when set (overrides stage default)', () => {
    const out = aggregateForecast([mkDeal({ value: 1000, probability: 80 })]);
    expect(out.stages[0]!.weightedValue).toBe(800); // 1000 * 0.80
  });

  it('falls back to stage probability when deal probability is null', () => {
    const out = aggregateForecast([mkDeal({ probability: null })]);
    expect(out.stages[0]!.weightedValue).toBe(500); // 1000 * 0.50
  });

  it('treats null value as 0 (neither crashes nor pollutes totals)', () => {
    const out = aggregateForecast([mkDeal({ value: null, probability: 100 })]);
    expect(out.stages[0]!.totalValue).toBe(0);
    expect(out.stages[0]!.weightedValue).toBe(0);
  });

  it('groups deals by stageId and rolls up totals', () => {
    const out = aggregateForecast([
      mkDeal({ id: 'd1', stageId: 'a', stage: { id: 'a', name: 'A', probability: 50 }, value: 100 }),
      mkDeal({ id: 'd2', stageId: 'a', stage: { id: 'a', name: 'A', probability: 50 }, value: 200 }),
      mkDeal({ id: 'd3', stageId: 'b', stage: { id: 'b', name: 'B', probability: 100 }, value: 50 }),
    ]);
    const bucketA = out.stages.find((s) => s.stageId === 'a')!;
    expect(bucketA.dealCount).toBe(2);
    expect(bucketA.totalValue).toBe(300);
    expect(bucketA.weightedValue).toBe(150); // 300 * 0.5
    expect(out.totalRaw).toBe(350);
    expect(out.totalWeighted).toBe(200); // 150 + 50
  });

  it('rounds weighted values to 2 decimals (no FP drift in UI)', () => {
    const out = aggregateForecast([mkDeal({ value: 333.33, probability: 33 })]);
    // 333.33 * 0.33 = 109.9989 → rounded to 110
    expect(out.stages[0]!.weightedValue).toBe(110);
  });
});
