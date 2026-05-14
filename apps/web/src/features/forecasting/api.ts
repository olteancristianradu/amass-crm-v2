import { api } from '@/lib/api';

// Match the API enum exactly (packages/shared/src/schemas/forecasting.ts):
// BE accepts only MONTHLY | QUARTERLY. YEARLY is not supported yet.
export type PeriodType = 'MONTHLY' | 'QUARTERLY';

export interface ForecastUserRow {
  userId: string;
  userName: string;
  dealsOpen: number;
  pipeline: number;
  commit: number;
  quota?: number | null;
}

export interface ForecastResponse {
  year: number;
  period: number;
  periodType: PeriodType;
  pipeline: number;
  commit: number;
  quota?: number | null;
  currency: string;
  rows: ForecastUserRow[];
}

export interface SetQuotaInput {
  userId?: string;
  year: number;
  period: number;
  periodType: PeriodType;
  value: number;
  currency?: string;
}

export const forecastingApi = {
  getForecast: (year: number, period: number, periodType: PeriodType) =>
    api.get<ForecastResponse>('/forecasting', {
      year,
      period,
      periodType,
    } as Record<string, string | number | undefined>),
  setQuota: (data: SetQuotaInput) => api.post<void>('/forecasting/quota', data),
};
