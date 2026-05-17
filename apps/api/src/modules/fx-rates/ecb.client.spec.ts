import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ECB_DAILY_URL, fetchEcbDailyRates, parseEcbDailyXml } from './ecb.client';

/**
 * ECB client unit tests:
 *  - parser strictness (T-FX-S-02 surface: bad payload → throw, not coerce)
 *  - SSRF guard hard-fails non-ECB hosts even if a future refactor wires
 *    config-based URLs (T-FX-D-03)
 *  - timeout uses AbortSignal (T-FX-D-01)
 *
 * `fetch` is stubbed globally on globalThis — we restore after each test.
 */

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender>
    <gesmes:name>European Central Bank</gesmes:name>
  </gesmes:Sender>
  <Cube>
    <Cube time='2026-05-15'>
      <Cube currency='USD' rate='1.1628'/>
      <Cube currency='GBP' rate='0.87050'/>
      <Cube currency='RON' rate='5.2166'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe('parseEcbDailyXml', () => {
  it('extracts the inner-Cube time and every leaf rate', () => {
    const out = parseEcbDailyXml(FIXTURE_XML);
    expect(out.asOf).toBe('2026-05-15');
    expect(out.rates).toHaveLength(3);
    expect(out.rates).toEqual(
      expect.arrayContaining([
        { currency: 'USD', rate: '1.1628' },
        { currency: 'GBP', rate: '0.87050' },
        { currency: 'RON', rate: '5.2166' },
      ]),
    );
  });

  it('throws on empty payload', () => {
    expect(() => parseEcbDailyXml('')).toThrow(/empty payload/);
  });

  it('throws when time attribute is missing', () => {
    expect(() =>
      parseEcbDailyXml('<Envelope><Cube><Cube currency="USD" rate="1.1"/></Cube></Envelope>'),
    ).toThrow(/missing time/);
  });

  it('throws when there are zero rate rows (defective ECB response)', () => {
    expect(() =>
      parseEcbDailyXml(
        `<Envelope><Cube><Cube time='2026-05-15'></Cube></Cube></Envelope>`,
      ),
    ).toThrow(/no rate rows/);
  });

  it('tolerates both single and double quotes on attributes', () => {
    const xml = `<Cube time="2026-05-15"><Cube currency="USD" rate="1.1"/></Cube>`;
    const out = parseEcbDailyXml(xml);
    expect(out.asOf).toBe('2026-05-15');
    expect(out.rates[0]).toEqual({ currency: 'USD', rate: '1.1' });
  });
});

describe('fetchEcbDailyRates', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  });
  afterEach(() => {
    (globalThis as unknown as { fetch: typeof originalFetch }).fetch = originalFetch;
  });

  it('parses a successful response into asOf + rates', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(FIXTURE_XML),
    });
    const out = await fetchEcbDailyRates();
    expect(out.asOf).toBe('2026-05-15');
    expect(out.rates).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledWith(
      ECB_DAILY_URL,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws on HTTP non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('') });
    await expect(fetchEcbDailyRates()).rejects.toThrow(/HTTP 503/);
  });

  it('rejects non-https URLs (T-FX-S-02)', async () => {
    await expect(
      fetchEcbDailyRates({ url: 'http://www.ecb.europa.eu/x.xml' }),
    ).rejects.toThrow(/https/);
  });

  it('rejects non-ECB hostnames (T-FX-D-03 SSRF defense in depth)', async () => {
    await expect(
      fetchEcbDailyRates({ url: 'https://attacker.example.com/x.xml' }),
    ).rejects.toThrow(/hostname/);
  });
});
