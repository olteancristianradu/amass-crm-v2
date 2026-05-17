import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FxRatesProcessor } from './fx-rates.processor';

/**
 * Processor unit tests stub the ECB client + FxRatesService surface so we
 * only exercise the BullMQ-facing glue:
 *   - happy path: fetch → upsert → metric ++
 *   - parse fail: throw → BullMQ retry path (we verify error metric in
 *     the onFailed hook by calling it directly, since the @OnWorkerEvent
 *     decorator isn't invoked by the test harness)
 *   - ignores unknown job names (no upsert, no throw)
 */

vi.mock('./ecb.client', () => ({
  fetchEcbDailyRates: vi.fn(),
}));
import { fetchEcbDailyRates } from './ecb.client';

function build() {
  const svc = {
    upsertEcbPayload: vi.fn().mockResolvedValue({ written: 6, sanityViolations: [] }),
  };
  const metrics = {
    recordFxRatesFetched: vi.fn(),
    recordFxRatesSanityViolation: vi.fn(),
  };
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const proc = new FxRatesProcessor(
    svc as unknown as ConstructorParameters<typeof FxRatesProcessor>[0],
    metrics as unknown as ConstructorParameters<typeof FxRatesProcessor>[1],
    audit as unknown as ConstructorParameters<typeof FxRatesProcessor>[2],
  );
  return { proc, svc, metrics, audit };
}

describe('FxRatesProcessor.process', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.resetAllMocks());

  it('fetches ECB, hands payload to service, increments success metric', async () => {
    const h = build();
    (fetchEcbDailyRates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      asOf: '2026-05-15',
      rates: [{ currency: 'RON', rate: '5.0500' }],
    });

    await h.proc.process({
      id: 'fx-daily-20260515',
      name: 'fx-rates-daily',
      data: { localDate: '2026-05-15' },
    } as never);

    expect(h.svc.upsertEcbPayload).toHaveBeenCalledOnce();
    const [asOfArg, ratesArg] = h.svc.upsertEcbPayload.mock.calls[0];
    expect(asOfArg).toEqual(new Date('2026-05-15T00:00:00.000Z'));
    expect(ratesArg).toEqual([{ currency: 'RON', rate: '5.0500' }]);
    expect(h.metrics.recordFxRatesFetched).toHaveBeenCalledWith('ECB', 'success', 6);
    expect(h.metrics.recordFxRatesSanityViolation).not.toHaveBeenCalled();
    // I-2: every successful ECB cycle emits one fx.rate.fetched audit row.
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fx.rate.fetched',
        subjectType: 'fx_rate_batch',
        metadata: expect.objectContaining({
          source: 'ECB',
          asOf: '2026-05-15',
          pairsWritten: 6,
        }),
      }),
    );
  });

  it('records a sanity-violation metric per offending pair (T-FX-S-01)', async () => {
    const h = build();
    (fetchEcbDailyRates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      asOf: '2026-05-15',
      rates: [{ currency: 'RON', rate: '6.1000' }],
    });
    h.svc.upsertEcbPayload.mockResolvedValue({
      written: 6,
      sanityViolations: [
        { from: 'EUR', to: 'RON', suspectedRate: '6.10', lastValidRate: '5.05', deviationPercent: 20.79 },
        { from: 'RON', to: 'EUR', suspectedRate: '0.16393', lastValidRate: '0.19802', deviationPercent: 17.21 },
      ],
    });
    await h.proc.process({
      id: 'fx-daily-20260515',
      name: 'fx-rates-daily',
      data: { localDate: '2026-05-15' },
    } as never);
    expect(h.metrics.recordFxRatesSanityViolation).toHaveBeenCalledTimes(2);
  });

  it('lets ECB fetch errors bubble (BullMQ retries via attempts config)', async () => {
    const h = build();
    (fetchEcbDailyRates as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('HTTP 503'),
    );
    await expect(
      h.proc.process({
        id: 'fx-daily-20260515',
        name: 'fx-rates-daily',
        data: { localDate: '2026-05-15' },
      } as never),
    ).rejects.toThrow(/503/);
    expect(h.svc.upsertEcbPayload).not.toHaveBeenCalled();
  });

  it('no-ops on unknown job names (defensive, BullMQ shouldn\'t enqueue them)', async () => {
    const h = build();
    await h.proc.process({
      id: 'x',
      name: 'unknown',
      data: {},
    } as never);
    expect(h.svc.upsertEcbPayload).not.toHaveBeenCalled();
  });
});

describe('FxRatesProcessor.onFailed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('increments the error metric so dashboards count outages', () => {
    const h = build();
    h.proc.onFailed(
      { id: 'job-1', attemptsMade: 3, opts: { attempts: 3 } } as never,
      new Error('boom'),
    );
    expect(h.metrics.recordFxRatesFetched).toHaveBeenCalledWith('ECB', 'error', 1);
  });
});
