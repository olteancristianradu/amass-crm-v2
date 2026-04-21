import type { Prisma, StageType } from '@prisma/client';

/**
 * M-12 — pure helpers extracted from DealsService. No DB, no Nest, no
 * tenant context — trivial to unit-test.
 */

export function stageTypeToStatus(type: StageType): 'OPEN' | 'WON' | 'LOST' {
  switch (type) {
    case 'OPEN':
      return 'OPEN';
    case 'WON':
      return 'WON';
    case 'LOST':
      return 'LOST';
  }
}

export interface ForecastDeal {
  id: string;
  title: string;
  value: Prisma.Decimal | number | null;
  currency: string;
  probability: number | null;
  stageId: string;
  stage: { id: string; name: string; probability: number | null };
}

export interface ForecastStageBucket {
  stageId: string;
  stageName: string;
  totalValue: number;
  weightedValue: number;
  dealCount: number;
  deals: Array<{
    id: string;
    title: string;
    value: number;
    currency: string;
    probability: number;
    weightedValue: number;
  }>;
}

export interface ForecastResult {
  stages: ForecastStageBucket[];
  totalRaw: number;
  totalWeighted: number;
}

/**
 * Pure aggregation: group open deals by stage, compute weighted value per
 * deal (probability × raw value), then roll up totals. Extracted so the
 * math can be unit-tested without a DB round-trip.
 */
export function aggregateForecast(deals: ForecastDeal[]): ForecastResult {
  const byStage = new Map<string, { stageName: string; deals: ForecastStageBucket['deals'] }>();
  for (const deal of deals) {
    const prob = (deal.probability ?? deal.stage.probability ?? 0) / 100;
    const raw = deal.value ? Number(deal.value) : 0;
    const weighted = Math.round(raw * prob * 100) / 100;
    const entry = byStage.get(deal.stageId) ?? { stageName: deal.stage.name, deals: [] };
    entry.deals.push({
      id: deal.id,
      title: deal.title,
      value: raw,
      currency: deal.currency,
      probability: prob * 100,
      weightedValue: weighted,
    });
    byStage.set(deal.stageId, entry);
  }

  const stages: ForecastStageBucket[] = Array.from(byStage.entries()).map(([stageId, data]) => ({
    stageId,
    stageName: data.stageName,
    totalValue: data.deals.reduce((s, d) => s + (d.value ?? 0), 0),
    weightedValue: data.deals.reduce((s, d) => s + d.weightedValue, 0),
    dealCount: data.deals.length,
    deals: data.deals,
  }));

  return {
    stages,
    totalRaw: stages.reduce((s, st) => s + st.totalValue, 0),
    totalWeighted: stages.reduce((s, st) => s + st.weightedValue, 0),
  };
}
