import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRate, FxRateSource, Prisma } from '@prisma/client';
import {
  ExchangeRateResponseDto,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { FxRateNotAvailableException } from './fx-rate-not-available.exception';

/**
 * FxRatesService — multi-currency conversion + public lookup.
 *
 * Three responsibilities:
 *   1. `convert(amount, from, to, asOf?)` — used by DealsService on
 *      create/update to compute `Deal.amountBase`. Prisma.Decimal end to
 *      end (T-FX-T-01: no IEEE-754 anywhere on the money path).
 *   2. `lookup(from, to, date?)` — backs `GET /exchange-rates`.
 *   3. `upsertEcbPayload(...)` — the cron worker hands the parsed ECB
 *      response over and we materialize the rows. Cross-rates between
 *      non-EUR pairs are computed on the fly so the lookup path is one
 *      indexed read.
 *
 * `ExchangeRate` is GLOBAL by design (schema.prisma:2747-2754) so this
 * service does NOT go through `runWithTenant` — `tenantExtension()`
 * no-ops because the model is not in `TENANT_SCOPED_MODELS`, and the
 * cron worker runs as the migration owner role (the only role with
 * INSERT/UPDATE/DELETE on `exchange_rates` per the REVOKE in
 * 20260517082112_phase_0_locale_currency_views).
 */
@Injectable()
export class FxRatesService {
  private readonly logger = new Logger(FxRatesService.name);

  /** Day-of-fetch cache TTL: 1h. Keeps ECB throttled (T-FX-D-02). */
  private static readonly CACHE_TTL_SECONDS = 60 * 60;

  /** Sanity bound on day-over-day rate moves (T-FX-S-01). 15% per spec. */
  private static readonly SANITY_BOUND_PCT = 0.15;

  /** Stale threshold for the `stale: true` response flag (spec 2.1). */
  private static readonly STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ─── Conversion (used by DealsService) ───────────────────────────────

  /**
   * Convert `amount` from `from` to `to` at the rate effective on `asOf`
   * (defaults to today). Returns a Prisma.Decimal so the caller can store
   * it directly without going through `parseFloat`.
   *
   * Throws:
   *   - FxRateNotAvailableException when no rate exists ≤ asOf for the pair.
   *     Mapped to HTTP 503 + Retry-After by AllExceptionsFilter so the FE
   *     (and internal Deal callers) can back off cleanly. We deliberately
   *     do NOT silently store NULL — that would skew weighted-forecast
   *     reports without leaving a trace.
   */
  async convert(
    amount: Prisma.Decimal,
    from: string,
    to: string,
    asOf?: Date,
  ): Promise<{ amountBase: Prisma.Decimal; fxRateAt: Date | null }> {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) {
      // No-op: same currency, no rate row required, no fxRateAt to record.
      return { amountBase: amount, fxRateAt: null };
    }
    const effectiveAsOf = asOf ?? new Date();
    const rate = await this.findRate(f, t, effectiveAsOf);
    if (!rate) {
      throw new FxRateNotAvailableException(f, t, effectiveAsOf);
    }
    // Prisma.Decimal arithmetic — T-FX-T-01.
    const amountBase = new Prisma.Decimal(amount).mul(rate.rate);
    // I-2: emit `fx.rate.applied` so audit + SIEM can correlate a downstream
    // money write (Deal.amountBase) with the exact FX snapshot used. Tenant +
    // actor come from ALS — when DealsService calls this inside a request,
    // both are present; when an internal job calls it (none today, but the
    // shape is ready), the audit row is dropped with a warn (never throws).
    void this.audit.log({
      action: 'fx.rate.applied',
      subjectType: 'fx_rate',
      subjectId: `${f}-${t}-${rate.asOf.toISOString().slice(0, 10)}`,
      metadata: {
        from: f,
        to: t,
        rate: rate.rate.toString(),
        asOf: rate.asOf.toISOString(),
        source: rate.source,
        amount: amount.toString(),
        amountBase: amountBase.toString(),
      },
    });
    return { amountBase, fxRateAt: rate.asOf };
  }

  // ─── Public lookup (GET /exchange-rates) ─────────────────────────────

  /**
   * Returns the latest rate ≤ date (default today). When the most recent
   * row is >24h old (ECB outage, long weekend) we flag `stale: true` so
   * the FE can warn the user.
   *
   * Cache key includes the asOf string so a query for last week never
   * pins the "today" cache slot. Cache hit avoids the DB round-trip
   * entirely (T-FX-D-02 throttle).
   */
  async lookup(
    from: string,
    to: string,
    date?: Date,
  ): Promise<ExchangeRateResponseDto> {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) {
      // Identity — return 1.0 so the FE doesn't special-case same-currency.
      const today = (date ?? new Date()).toISOString().slice(0, 10);
      return {
        fromCurrency: f as SupportedCurrency,
        toCurrency: t as SupportedCurrency,
        rate: '1',
        asOf: today,
        source: 'MANUAL',
      };
    }

    const asOfDate = date ?? new Date();
    const cacheKey = this.cacheKey(f, t, asOfDate);
    const cached = await this.cacheGet(cacheKey);
    if (cached) {
      return cached;
    }

    const row = await this.findRate(f, t, asOfDate);
    if (!row) {
      throw new FxRateNotAvailableException(f, t, asOfDate);
    }
    const ageMs = Date.now() - row.asOf.getTime();
    const stale = ageMs > FxRatesService.STALE_THRESHOLD_MS;
    const body: ExchangeRateResponseDto = {
      fromCurrency: f as SupportedCurrency,
      toCurrency: t as SupportedCurrency,
      rate: row.rate.toString(),
      asOf: row.asOf.toISOString().slice(0, 10),
      source: row.source,
      ...(stale ? { stale: true } : {}),
    };
    await this.cacheSet(cacheKey, body);
    return body;
  }

  // ─── Cron worker ingest path ─────────────────────────────────────────

  /**
   * Upsert the parsed ECB payload + every cross-rate combination across
   * `SUPPORTED_CURRENCIES`. Idempotent — the unique index
   * `exchange_rates_pair_date_unique` collapses duplicate (from, to, asOf)
   * tuples, and Prisma `upsert` does INSERT...ON CONFLICT UPDATE.
   *
   * Returns the number of pair rows written so the caller can emit the
   * `fx_rates_fetched_total{status="success"} +N` counter delta.
   *
   * IMPORTANT (T-FX-T-03 — historic rate immutability): this function
   * only ever stamps the row keyed by (from, to, asOf). Past rows are
   * untouched. Deal.amountBase that was computed at deal-creation time
   * stays frozen at its fxRateAt snapshot regardless of what this writes.
   */
  async upsertEcbPayload(
    asOf: Date,
    eurRates: ReadonlyArray<{ currency: string; rate: string }>,
    options: { sanityCheck?: boolean } = {},
  ): Promise<{
    written: number;
    sanityViolations: Array<{
      from: string;
      to: string;
      suspectedRate: string;
      lastValidRate: string;
      deviationPercent: number;
    }>;
  }> {
    const sanityCheck = options.sanityCheck ?? true;
    // Build EUR→X map filtered to our supported set + always include the
    // identity EUR→EUR=1 so cross-rate math (X→EUR via 1/EUR_X) closes.
    const eurMap = new Map<string, Prisma.Decimal>([
      ['EUR', new Prisma.Decimal(1)],
    ]);
    for (const r of eurRates) {
      if (
        (SUPPORTED_CURRENCIES as readonly string[]).includes(r.currency.toUpperCase())
      ) {
        eurMap.set(r.currency.toUpperCase(), new Prisma.Decimal(r.rate));
      }
    }
    // Build the full set of pair rows we want to materialize.
    // For each (from, to) in supported × supported with from ≠ to:
    //   rate(from→to) = eurMap[to] / eurMap[from]
    // EUR→X is direct; X→EUR is 1 / eurMap[X]; non-EUR cross is the
    // composed quotient. This collapses ~30 pairs into one batch.
    const pairs: Array<{ from: string; to: string; rate: Prisma.Decimal }> = [];
    for (const from of SUPPORTED_CURRENCIES) {
      for (const to of SUPPORTED_CURRENCIES) {
        if (from === to) continue;
        const fromRate = eurMap.get(from);
        const toRate = eurMap.get(to);
        if (!fromRate || !toRate) continue; // ECB didn't publish this code
        const rate = toRate.div(fromRate);
        pairs.push({ from, to, rate });
      }
    }

    // T-FX-S-01 — sanity check FIRST, then upsert only the survivors. The
    // earlier implementation logged + upserted regardless, which defeats the
    // purpose: a DNS-hijacked ECB feed claiming `1 EUR = 0.0001 RON` would
    // still land in the DB and every downstream Deal.amountBase recompute
    // would adopt it. Now: violations are REJECTED → yesterday's rate stays
    // in place → operators are alerted via metrics + audit + log.
    const sanityViolations: Array<{
      from: string;
      to: string;
      suspectedRate: string;
      lastValidRate: string;
      deviationPercent: number;
    }> = [];
    if (sanityCheck) {
      for (const p of pairs) {
        const prev = await this.findRate(p.from, p.to, this.daysAgo(asOf, 1));
        if (!prev) continue; // no prior rate, can't compare → must allow
        // |new - prev| / prev > 0.15 ?
        const delta = p.rate.minus(prev.rate).abs().div(prev.rate).toNumber();
        if (delta > FxRatesService.SANITY_BOUND_PCT) {
          sanityViolations.push({
            from: p.from,
            to: p.to,
            suspectedRate: p.rate.toString(),
            lastValidRate: prev.rate.toString(),
            deviationPercent: Math.round(delta * 10_000) / 100, // 2-decimal pct
          });
          this.logger.warn(
            `T-FX-S-01 REJECT: ${p.from}->${p.to} delta=${delta.toFixed(4)} suspect=${p.rate} last=${prev.rate}`,
          );
        }
      }
    }
    const rejectSet = new Set(sanityViolations.map((v) => `${v.from}->${v.to}`));

    // Audit each rejection so an investigator can replay the decision. Best-
    // effort (audit never throws) and we don't await individually — we let
    // the loop fire-and-forget then move to the upsert phase.
    for (const v of sanityViolations) {
      void this.audit.log({
        action: 'fx.rate.rejected',
        subjectType: 'fx_rate',
        subjectId: `${v.from}-${v.to}-${asOf.toISOString().slice(0, 10)}`,
        metadata: {
          from: v.from,
          to: v.to,
          asOf: asOf.toISOString(),
          suspectedRate: v.suspectedRate,
          lastValidRate: v.lastValidRate,
          deviationPercent: v.deviationPercent,
          boundPercent: FxRatesService.SANITY_BOUND_PCT * 100,
        },
      });
    }

    // Upsert each pair that survived sanity. Sequential is fine — ~30 rows
    // max, and serializing keeps audit deterministic.
    let written = 0;
    for (const p of pairs) {
      if (rejectSet.has(`${p.from}->${p.to}`)) {
        // Skip upsert — last-known good rate from a prior day stays in place
        // and FxRatesService.convert() will keep using it via findRate's
        // `asOf: { lte }` ordering. The Deals that already have amountBase
        // computed against the prior snapshot are untouched (T-FX-T-03).
        continue;
      }
      await this.prisma.exchangeRate.upsert({
        where: {
          fromCurrency_toCurrency_asOf: {
            fromCurrency: p.from,
            toCurrency: p.to,
            asOf,
          },
        },
        update: {
          rate: p.rate,
          fetchedAt: new Date(),
          source: FxRateSource.ECB,
        },
        create: {
          fromCurrency: p.from,
          toCurrency: p.to,
          rate: p.rate,
          asOf,
          source: FxRateSource.ECB,
        },
      });
      written++;
    }

    // Bust the cache so the new asOf is reflected immediately on the next
    // public lookup (cache TTL is 1h, but a same-day re-run before that
    // expires would otherwise return the old value).
    await this.cacheBust(asOf);

    return { written, sanityViolations };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /**
   * Latest rate ≤ asOf for (from, to). Single indexed read against
   * `exchange_rates_as_of_desc_idx`. Returns null when no row exists —
   * callers translate into the appropriate domain error.
   */
  private async findRate(from: string, to: string, asOf: Date): Promise<ExchangeRate | null> {
    return this.prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: from,
        toCurrency: to,
        asOf: { lte: asOf },
      },
      orderBy: { asOf: 'desc' },
    });
  }

  private daysAgo(d: Date, n: number): Date {
    const copy = new Date(d);
    copy.setUTCDate(copy.getUTCDate() - n);
    return copy;
  }

  // ─── Redis cache layer ───────────────────────────────────────────────

  private cacheKey(from: string, to: string, asOf: Date): string {
    return `fx:rate:${from}:${to}:${asOf.toISOString().slice(0, 10)}`;
  }

  private async cacheGet(key: string): Promise<ExchangeRateResponseDto | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as ExchangeRateResponseDto;
    } catch (err) {
      // Cache failure must NEVER block a lookup — log + fall through to DB.
      this.logger.warn(
        `fx.cache.get failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async cacheSet(key: string, value: ExchangeRateResponseDto): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(value),
        'EX',
        FxRatesService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `fx.cache.set failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Bust every cache entry for the given asOf. Scoped narrow on purpose. */
  private async cacheBust(asOf: Date): Promise<void> {
    const day = asOf.toISOString().slice(0, 10);
    try {
      // SCAN is safer than KEYS in prod (non-blocking). For ~30 pairs the
      // single batch fits in one COUNT cycle.
      const stream = this.redis.client.scanStream({
        match: `fx:rate:*:*:${day}`,
        count: 100,
      });
      const keys: string[] = [];
      for await (const batch of stream) {
        keys.push(...(batch as string[]));
      }
      if (keys.length > 0) {
        await this.redis.client.del(...keys);
      }
    } catch (err) {
      this.logger.warn(
        `fx.cache.bust failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
