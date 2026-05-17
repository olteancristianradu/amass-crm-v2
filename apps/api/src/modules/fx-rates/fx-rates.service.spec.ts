import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FxRateSource, Prisma } from '@prisma/client';
import { FxRatesService } from './fx-rates.service';

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
  const svc = new FxRatesService(prisma, redis);
  return { svc, exchangeRate, redisClient };
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

  it('throws NotFoundException when no rate row exists', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null);
    await expect(h.svc.convert(new Prisma.Decimal('100'), 'EUR', 'RON')).rejects.toBeInstanceOf(
      NotFoundException,
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

  it('throws ServiceUnavailableException when no rate row exists', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(null);
    await expect(h.svc.lookup('EUR', 'RON')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('falls through to DB when cache read errors (no throw)', async () => {
    const h = build();
    h.redisClient.get.mockRejectedValueOnce(new Error('redis down'));
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const out = await h.svc.lookup('EUR', 'RON');
    expect(out.rate).toBe('5.0500');
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

  it('T-FX-S-01: emits sanity violation when day-over-day move > 15%', async () => {
    const h = build();
    // Prior rate 5.05; new rate 6.10 → ~20.8% jump → violation.
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const asOf = new Date('2026-05-17T00:00:00Z');
    const out = await h.svc.upsertEcbPayload(asOf, [{ currency: 'RON', rate: '6.1000' }]);
    expect(out.sanityViolations.length).toBeGreaterThan(0);
    // The row is still upserted — we DON'T silently drop it (silently
    // substituting yesterday's value would mask a real currency event).
    expect(h.exchangeRate.upsert).toHaveBeenCalled();
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

  it('honours sanityCheck=false toggle (used in seed scripts)', async () => {
    const h = build();
    h.exchangeRate.findFirst.mockResolvedValue(makeRow({ rate: '5.0500' }));
    const asOf = new Date('2026-05-17T00:00:00Z');
    const out = await h.svc.upsertEcbPayload(
      asOf,
      [{ currency: 'RON', rate: '6.1000' }],
      { sanityCheck: false },
    );
    expect(out.sanityViolations).toEqual([]);
  });
});
