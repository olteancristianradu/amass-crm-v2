import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FxRatesController } from './fx-rates.controller';

/**
 * Controller is a thin pass-through to FxRatesService.lookup — we assert
 * the query/date glue and that the service is invoked with the right
 * parsed Date object. Authn (JwtAuthGuard) + Zod parsing are covered by
 * the e2e suite in apps/api/test/multi-currency.e2e.spec.ts.
 */

function build() {
  const svc = { lookup: vi.fn() };
  const controller = new FxRatesController(svc as unknown as ConstructorParameters<typeof FxRatesController>[0]);
  return { controller, svc };
}

describe('FxRatesController.getRate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to FxRatesService.lookup with parsed UTC date when date is provided', async () => {
    const h = build();
    h.svc.lookup.mockResolvedValue({ rate: '5.05', asOf: '2026-05-17', source: 'ECB' });
    await h.controller.getRate({ from: 'EUR', to: 'RON', date: '2026-05-17' });
    expect(h.svc.lookup).toHaveBeenCalledWith(
      'EUR',
      'RON',
      new Date('2026-05-17T00:00:00.000Z'),
    );
  });

  it('passes undefined date when query.date is absent (service defaults to today)', async () => {
    const h = build();
    h.svc.lookup.mockResolvedValue({ rate: '5.05', asOf: '2026-05-17', source: 'ECB' });
    await h.controller.getRate({ from: 'EUR', to: 'RON' });
    expect(h.svc.lookup).toHaveBeenCalledWith('EUR', 'RON', undefined);
  });
});
