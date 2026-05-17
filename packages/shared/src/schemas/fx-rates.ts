import { z } from 'zod';

/**
 * Phase 0 / Feature 2 — Multi-currency.
 *
 * The set of currency codes we accept on Deal write paths and the
 * `/exchange-rates` endpoint query string. Deliberately narrow: ECB
 * publishes ~30 codes daily, but the RO-SMB market only quotes in this
 * shortlist in practice, and a closed enum kills T-FX-E-01 ("user
 * mutates currency to an exotic 3-decimal code that breaks invoicing").
 *
 * Extending the list:
 *   1. add the code below
 *   2. confirm ECB publishes it (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)
 *   3. the cron picks it up automatically on next run
 *   4. no migration required (ExchangeRate.fromCurrency is VarChar(3))
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'RON', 'USD', 'GBP', 'CHF', 'PLN'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CurrencyCodeSchema = z.enum(SUPPORTED_CURRENCIES);

/**
 * Source of an exchange rate. Mirrors the Prisma `FxRateSource` enum
 * (schema.prisma:2759). Kept in sync manually — if you add a value here,
 * add it to the Prisma enum + run a migration.
 */
export const FxRateSourceSchema = z.enum(['ECB', 'FIXER', 'MANUAL']);
export type FxRateSourceDto = z.infer<typeof FxRateSourceSchema>;

/**
 * Query for `GET /api/v1/exchange-rates`. Both currencies are required —
 * the endpoint does NOT default `from=EUR` so the caller is always
 * explicit. `date` is optional ISO date string (YYYY-MM-DD); when absent
 * the latest available rate is returned (typical UI flow).
 *
 * `date` is coerced to a Date so downstream `findFirst({ asOf: { lte } })`
 * can compare deterministically.
 */
export const ExchangeRateQuerySchema = z.object({
  from: CurrencyCodeSchema,
  to: CurrencyCodeSchema,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD')
    .optional(),
});
export type ExchangeRateQueryDto = z.infer<typeof ExchangeRateQuerySchema>;

/**
 * Wire shape returned by `GET /exchange-rates`. `rate` is stringified so
 * arbitrary-precision is preserved over JSON (matches the Deal.value
 * convention — see schemas/deal.ts).
 *
 * `stale` is true when the latest available rate is more than 24h old
 * (e.g. ECB outage / weekend gap > Monday). FE may surface a warning to
 * the user; the rate is still safe to use, just not "today's".
 */
export const ExchangeRateResponseSchema = z.object({
  fromCurrency: CurrencyCodeSchema,
  toCurrency: CurrencyCodeSchema,
  rate: z.string(),
  asOf: z.string(),
  source: FxRateSourceSchema,
  stale: z.boolean().optional(),
});
export type ExchangeRateResponseDto = z.infer<typeof ExchangeRateResponseSchema>;
