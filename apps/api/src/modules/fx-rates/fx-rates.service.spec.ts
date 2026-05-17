import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FxRateSource, Prisma } from '@prisma/client';
import { FxRatesService } from './fx-rates.service';
import { FxRateNotAvailableException } from './fx-rate-not-available.exception';

/**
 * FxRatesService covers four code paths:
 *   1. convert()            — Deal.amountBase recompute hook
 *   2. lookup()             — backs GET /exchange-rates
 *   3. upsertEcbPayload()   — cron worker ingest, includes cross-rate math
 *                             + T-FX-S-01 sanity bound
 *   4. Redis cache          — get/set/bust with graceful degradation
 *
 * We stub Prisma + ioredis at the surface so the unit tests run without a
 * live DB / Redis. Cross-rate math is asserted with explicit Decimal
 * comparisons to confirm no IEEE-754 drift (T-FX-T-01).
 */

function makeRow(overrides: Partial<{
  rate: string;
  asOf: Date;
  source: FxRateSource;
  fromCurrency: string;
  toCurrency: string;
}> = {}) {
  return {
    id: 'fx-1',
    fromCurrency: 'EUR',
    toCurrency: 'RON',
    rate: new Prisma.Decimal(overrides.rate ?? '5.0500'),
    asOf: overrides.asOf ?? new Date('2026-05-17T00:00:00Z'),
    source: overrides.source ?? FxRateSource.ECB,
    fetchedAt: new Date('2026-05-17T06:00:00Z'),
    createdAt: new Date('2026-05-17T06:00:00Z'),
    ...overrides,
  };
}

function build() {
  // Default cache miss + writes a no-op. Individual tests override.
  const redisClient = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(0),
    scanStream: vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield [] as string[];
      },
    }),
  };
  const exchangeRate = {
    findFirst: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const prisma = { exchangeRate } as unknown as ConstructorParameters<typeof FxRatesService>[0];
  const redis = { client: redisClient } as unknown as ConstructorParameters<typeof FxRatesService>[1];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof FxRatesService>[2];
  const svc = new FxRatesService(prisma, redis, audit);
  return { svc, exchangeRate, redisClient, audit: audit as unknown as { log: ReturnType<typeof vi.fn> } };
}

describe('FxRatesService.convert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns amount unchanged when from === to (no DB hit)', async () => {
    const h = build();
    const out = await h.svc.convert(new Prisma.Decimal('100'), 'RON', 'RON');
    expect(out.amountBase.toString()).toBe('100');
    expect(out.fxRateAt).toBeNull();
    expect(h.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('multiplies amount by latest rate ≤ asOf', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const out = await h.svc.convert(new Prisma.Decimal('1000'), 'EUR', 'RON');
    expect(out.amountBase.toString()).toBe('5050');
    expect(out.fxRateAt).toEqual(new Date('2026-05-17T00:00:00Z'));
  });

  it('throws FxRateNotAvailableException when no rate row exists', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null);
    await expect(h.svc.convert(new Prisma.Decimal('100'), 'EUR', 'RON')).rejects.toBeInstanceOf(
      FxRateNotAvailableException,
    );
  });

  it('I-2: emits fx.rate.applied audit event on successful convert', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    await h.svc.convert(new Prisma.Decimal('1000'), 'EUR', 'RON');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fx.rate.applied',
        subjectType: 'fx_rate',
        metadata: expect.objectContaining({
          from: 'EUR',
          to: 'RON',
          // Prisma.Decimal preserves the trailing zeros from the input
          // ('5.0500' in, '5.0500' out) — we deliberately don't normalise.
          rate: '5.0500',
          amount: '1000',
          amountBase: '5050',
        }),
      }),
    );
  });

  it('preserves Decimal precision — 0.1 × 4.9750 = 0.49750 (no IEEE drift)', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '4.9750' }));
    const out = await h.svc.convert(new Prisma.Decimal('0.1'), 'EUR', 'RON');
    // Prisma.Decimal does exact arithmetic; no 0.4974999... leakage.
    expect(out.amountBase.toString()).toBe('0.4975');
  });
});

describe('FxRatesService.lookup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns identity rate 1 when from === to', async () => {
    const h = build();
    const out = await h.svc.lookup('RON', 'RON');
    expect(out.rate).toBe('1');
    expect(out.source).toBe('MANUAL');
    expect(h.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('caches the response on first lookup (DB hit) and serves from cache next', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const first = await h.svc.lookup('EUR', 'RON');
    // Prisma.Decimal preserves the input's significant trailing zeros, so
    // the rate that came in as '5.0500' goes back out as '5.0500' (NOT '5.05').
    expect(first.rate).toBe('5.0500');
    expect(h.redisClient.set).toHaveBeenCalled();

    // Second call — simulate cache hit.
    h.redisClient.get.mockResolvedValueOnce(JSON.stringify(first));
    h.exchangeRate.findFirst.mockClear();
    const second = await h.svc.lookup('EUR', 'RON');
    expect(second).toEqual(first);
    expect(h.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('flags stale=true when latest rate is > 24h old', async () => {
    const h = build();
    const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000);
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500', asOf: oldDate }));
    const out = await h.svc.lookup('EUR', 'RON');
    expect(out.stale).toBe(true);
  });

  it('throws FxRateNotAvailableException when no rate row exists', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null);
    await expect(h.svc.lookup('EUR', 'RON')).rejects.toBeInstanceOf(FxRateNotAvailableException);
  });

  it('falls through to DB when cache read errors (no throw)', async () => {
    const h = build();
    h.redisClient.get.mockRejectedValueOnce(new Error('redis down'));
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const out = await h.svc.lookup('EUR', 'RON');
    expect(out.rate).toBe('5.0500');
  });
});

describe('ExchangeRateQuerySchema — MED-3 (calendar-valid date)', () => {
  it('accepts a real calendar date YYYY-MM-DD', async () => {
    const { ExchangeRateQuerySchema } = await import('@amass/shared');
    const r = ExchangeRateQuerySchema.safeParse({ from: 'EUR', to: 'RON', date: '2026-05-17' });
    expect(r.success).toBe(true);
  });

  it('rejects garbage like 9999-99-99 (passes regex, fails refine)', async () => {
    const { ExchangeRateQuerySchema } = await import('@amass/shared');
    const r = ExchangeRateQuerySchema.safeParse({ from: 'EUR', to: 'RON', date: '9999-99-99' });
    expect(r.success).toBe(false);
  });

  it('rejects Feb 30 (calendar-invalid, regex-valid)', async () => {
    const { ExchangeRateQuerySchema } = await import('@amass/shared');
    const r = ExchangeRateQuerySchema.safeParse({ from: 'EUR', to: 'RON', date: '2026-02-30' });
    expect(r.success).toBe(false);
  });

  it('accepts Feb 29 in a leap year (2024)', async () => {
    const { ExchangeRateQuerySchema } = await import('@amass/shared');
    const r = ExchangeRateQuerySchema.safeParse({ from: 'EUR', to: 'RON', date: '2024-02-29' });
    expect(r.success).toBe(true);
  });
});

describe('FxRatesService.upsertEcbPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts EUR→X direct rates + X→EUR inverse + non-EUR cross-rates', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null); // no prior rate → no sanity check fires
    const asOf = new Date('2026-05-17T00:00:00Z');
    const out = await h.svc.upsertEcbPayload(asOf, [
      { currency: 'RON', rate: '5.0500' },
      { currency: 'USD', rate: '1.1000' },
    ]);
    // Supported set has 6 codes; ECB delivered 2 + EUR identity = 3 covered.
    // Pairs: 3 * 2 = 6 directed combinations.
    expect(out.written).toBe(6);
    expect(h.exchangeRate.upsert).toHaveBeenCalledTimes(6);

    // Pick the EUR→RON call and assert the rate is the direct value.
    const eurRon = h.exchangeRate.upsert.mock.calls.find(
      (c: unknown[]) => {
        const args = c[0] as { create: { fromCurrency: string; toCurrency: string } };
        return args.create.fromCurrency === 'EUR' && args.create.toCurrency === 'RON';
      },
    );
    expect(eurRon).toBeTruthy();
    const eurRonArgs = (eurRon as unknown[])[0] as { create: { rate: Prisma.Decimal } };
    expect(eurRonArgs.create.rate.toString()).toBe('5.05');

    // RON→USD cross-rate = (EUR→USD) / (EUR→RON) = 1.1 / 5.05 ≈ 0.2178…
    const ronUsd = h.exchangeRate.upsert.mock.calls.find(
      (c: unknown[]) => {
        const args = c[0] as { create: { fromCurrency: string; toCurrency: string } };
        return args.create.fromCurrency === 'RON' && args.create.toCurrency === 'USD';
      },
    );
    expect(ronUsd).toBeTruthy();
    const ronUsdArgs = (ronUsd as unknown[])[0] as { create: { rate: Prisma.Decimal } };
    // 1.1 / 5.05 = 0.2178217821782178... — assert via Prisma.Decimal equality.
    expect(ronUsdArgs.create.rate.toFixed(8)).toBe(
      new Prisma.Decimal('1.1').div('5.05').toFixed(8),
    );
  });

  it('idempotent: re-running the same payload calls upsert (not insert) again', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null);
    const asOf = new Date('2026-05-17T00:00:00Z');
    await h.svc.upsertEcbPayload(asOf, [{ currency: 'RON', rate: '5.0500' }]);
    await h.svc.upsertEcbPayload(asOf, [{ currency: 'RON', rate: '5.0500' }]);
    // 2 currencies in supported (EUR, RON) → 2 pairs each run × 2 runs = 4.
    expect(h.exchangeRate.upsert).toHaveBeenCalledTimes(4);
  });

  it('HIGH-1 / T-FX-S-01: REJECTS upsert on day-over-day move > 15% (yesterday\'s rate stays)', async () => {
    const h = build();
    // Prior rate 5.05; new rate 6.10 → ~20.8% jump → violation.
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const asOf = new Date('2026-05-17T00:00:00Z');
    const out = await h.svc.upsertEcbPayload(asOf, [{ currency: 'RON', rate: '6.1000' }]);
    expect(out.sanityViolations.length).toBeGreaterThan(0);
    // Violations should carry suspectedRate + lastValidRate + deviationPercent
    // so the audit row + operator dashboard have enough context to triage.
    expect(out.sanityViolations[0]).toMatchObject({
      from: 'EUR',
      to: 'RON',
      suspectedRate: expect.any(String),
      lastValidRate: expect.any(String),
      deviationPercent: expect.any(Number),
    });
    // The CORE assertion: no upsert happens for the suspect pair. Yesterday's
    // rate stays in place and Deal.amountBase keeps using it via findRate's
    // `asOf: { lte }` ordering. The other direction (RON->EUR) is the
    // mathematical inverse so it ALSO violates and is also skipped.
    expect(h.exchangeRate.upsert).not.toHaveBeenCalled();
    expect(out.written).toBe(0);
  });

  it('HIGH-1 / I-2: emits fx.rate.rejected audit event per violation', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const asOf = new Date('2026-05-17T00:00:00Z');
    await h.svc.upsertEcbPayload(asOf, [{ currency: 'RON', rate: '6.1000' }]);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fx.rate.rejected',
        subjectType: 'fx_rate',
        metadata: expect.objectContaining({
          from: 'EUR',
          to: 'RON',
          suspectedRate: expect.any(String),
          // Prisma.Decimal preserves the seed's trailing zeros (`5.0500`).
          lastValidRate: '5.0500',
          deviationPercent: expect.any(Number),
          boundPercent: 15,
        }),
      }),
    );
  });

  it('HIGH-1: still upserts pairs that pass sanity when only ONE pair violates', async () => {
    const h = build();
    // Make findRate return a prior 5.05 for EUR<->RON pair, null for everything else.
    h.exchangeRate.findFirst.mockImplementation((args: { where: { fromCurrency: string; toCurrency: string } }) => {
      const { fromCurrency, toCurrency } = args.where;
      if ((fromCurrency === 'EUR' && toCurrency === 'RON') || (fromCurrency === 'RON' && toCurrency === 'EUR')) {
        return Promise.resolve(makeRow({ rate: '5.0500' }));
      }
      return Promise.resolve(null); // no prior → can't compare → pair allowed through
    });
    const asOf = new Date('2026-05-17T00:00:00Z');
    // EUR->RON jumps to 6.10 (violates). USD comes through clean. The other
    // EUR-X / X-EUR / X-Y pairs all have no prior rate so they upsert freely.
    const out = await h.svc.upsertEcbPayload(asOf, [
      { currency: 'RON', rate: '6.1000' },
      { currency: 'USD', rate: '1.1000' },
    ]);
    // EUR<->RON BOTH violate (forward + inverse) → 2 rejected, others upsert.
    expect(out.sanityViolations.length).toBe(2);
    // 3 codes covered (EUR, RON, USD) → 6 directed pairs total; 2 rejected → 4 written.
    expect(out.written).toBe(4);
    expect(h.exchangeRate.upsert).toHaveBeenCalledTimes(4);
  });

  it('skips currencies not in SUPPORTED_CURRENCIES (e.g. JPY, BRL)', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null);
    const asOf = new Date('2026-05-17T00:00:00Z');
    const out = await h.svc.upsertEcbPayload(asOf, [
      { currency: 'JPY', rate: '180.00' }, // not in supported set
      { currency: 'RON', rate: '5.0500' },
    ]);
    // Only EUR + RON make it into the pair table → 2 pairs.
    expect(out.written).toBe(2);
  });

  it('honours sanityCheck=false toggle (used in seed scripts) — bypasses reject', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const asOf = new Date('2026-05-17T00:00:00Z');
    const out = await h.svc.upsertEcbPayload(
      asOf,
      [{ currency: 'RON', rate: '6.1000' }],
      { sanityCheck: false },
    );
    expect(out.sanityViolations).toEqual([]);
    // With sanityCheck off, the suspect rate goes straight in — 2 EUR<->RON pairs.
    expect(h.exchangeRate.upsert).toHaveBeenCalledTimes(2);
    expect(out.written).toBe(2);
  });
});
