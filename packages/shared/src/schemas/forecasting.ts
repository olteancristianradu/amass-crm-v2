import { z } from 'zod';

/**
 * S55 Forecasting — quota management and pipeline-vs-quota reporting.
 *
 * A ForecastQuota record pins a revenue target for a specific user,
 * year and period. The forecast endpoint then computes actual pipeline
 * value against that target, broken down by:
 *   - pipeline:   all OPEN deals × their probability  (weighted)
 *   - commit:     OPEN deals with probability ≥ 70
 *   - best_case:  all OPEN deals at face value
 */

export const ForecastPeriodTypeSchema = z.enum(['MONTHLY', 'QUARTERLY']);
export type ForecastPeriodTypeDto = z.infer<typeof ForecastPeriodTypeSchema>;

export const SetQuotaSchema = z.object({
  userId: z.string().min(1).max(64),
  year: z.number().int().min(2000).max(2100),
  period: z.number().int().min(1).max(12),
  periodType: ForecastPeriodTypeSchema.default('MONTHLY'),
  quota: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'quota must be a positive decimal with up to 2 fraction digits'),
  currency: z.string().trim().length(3).toUpperCase().default('RON'),
});
export type SetQuotaDto = z.infer<typeof SetQuotaSchema>;

export const GetForecastQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  period: z.coerce.number().int().min(1).max(12),
  periodType: ForecastPeriodTypeSchema.default('MONTHLY'),
});
export type GetForecastQueryDto = z.infer<typeof GetForecastQuerySchema>;

export const GetTeamForecastQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  period: z.coerce.number().int().min(1).max(12),
  periodType: ForecastPeriodTypeSchema.default('MONTHLY'),
});
export type GetTeamForecastQueryDto = z.infer<typeof GetTeamForecastQuerySchema>;
