/**
 * ECB daily reference rates HTTP client.
 *
 * Phase 0 / Feature 2 — multi-currency. Threat-model mitigations:
 *   - T-FX-S-02: URL is hard-coded HTTPS, no env override, no per-tenant
 *                configurability — closes the "someone copy-pasted http://"
 *                regression class.
 *   - T-FX-D-03: SSRF surface is zero because the URL is a literal — there
 *                is nothing user-controlled to point at 169.254.169.254.
 *                A hostname guard is still applied as belt-and-braces in
 *                case a future refactor introduces config.
 *   - T-FX-D-01: 10s per-request timeout via AbortSignal so a slow ECB
 *                cannot stall the BullMQ worker indefinitely.
 *
 * ECB publishes one XML file per day (~16:00 CET, working days only); the
 * structure is stable since 2002 and we parse it with a strict regex
 * rather than pulling in a full XML library (zero new deps, smaller attack
 * surface). The XML payload is ~3 KB so the cost is negligible.
 */

/** Frozen URL — do NOT make this configurable (T-FX-D-03). */
export const ECB_DAILY_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

const ECB_HOSTNAME = 'www.ecb.europa.eu';

/** One parsed currency entry. ECB always quotes EUR as the base. */
export interface EcbRate {
  /** ISO 4217 target currency, e.g. "USD". */
  currency: string;
  /** Decimal-as-string so we never cross IEEE-754 (T-FX-T-01). */
  rate: string;
}

/** Result of one ECB fetch — both the rates and the asOf they apply to. */
export interface EcbDailyPayload {
  /** YYYY-MM-DD as published by ECB in the inner `<Cube time='...'>`. */
  asOf: string;
  rates: EcbRate[];
}

/**
 * Sanity guard on the URL we are about to fetch. Currently the URL is a
 * frozen constant, so this is a no-op in practice; we keep it because a
 * future refactor that wires `env.ECB_URL` would otherwise re-open the
 * SSRF hole silently.
 */
function assertEcbUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('ecb.fetch: invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('ecb.fetch: only https:// is permitted');
  }
  if (parsed.hostname !== ECB_HOSTNAME) {
    throw new Error(`ecb.fetch: hostname must be ${ECB_HOSTNAME}, got ${parsed.hostname}`);
  }
}

/**
 * Strict regex parser for the ECB envelope:
 *   <Cube time='YYYY-MM-DD'>
 *     <Cube currency='XXX' rate='123.456'/>
 *     ...
 *   </Cube>
 *
 * Rejects malformed payloads (missing time attribute, no inner Cubes) with
 * an Error rather than returning a partial result — the worker layer maps
 * the error into an `fx_rates_fetched_total{status="error"}` increment.
 */
export function parseEcbDailyXml(xml: string): EcbDailyPayload {
  if (typeof xml !== 'string' || xml.length === 0) {
    throw new Error('ecb.parse: empty payload');
  }
  // Find the inner <Cube time='...'> wrapper (not the outermost <Cube/>).
  const timeMatch = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!timeMatch) {
    throw new Error('ecb.parse: missing time attribute');
  }
  const asOf = timeMatch[1];

  // Pull every leaf Cube. ECB uses single quotes; we tolerate both.
  // currency: ISO 4217 (3 uppercase letters); rate: positive decimal.
  const rateRe =
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"](\d+\.\d+)['"]\s*\/?>/g;
  const rates: EcbRate[] = [];
  let m: RegExpExecArray | null;
  while ((m = rateRe.exec(xml)) !== null) {
    rates.push({ currency: m[1], rate: m[2] });
  }
  if (rates.length === 0) {
    throw new Error('ecb.parse: no rate rows found');
  }
  return { asOf, rates };
}

/**
 * Fetch + parse today's ECB rates. Throws on HTTP error or parse failure.
 * The caller is the BullMQ worker, which translates the throw into a job
 * retry (T-FX-D-01: BullMQ exponential backoff handles transient outages).
 *
 * `timeoutMs` is wired via AbortSignal — Node 22's global `fetch` supports
 * AbortController natively, no `undici` import required.
 */
export async function fetchEcbDailyRates(
  options: { timeoutMs?: number; url?: string } = {},
): Promise<EcbDailyPayload> {
  const url = options.url ?? ECB_DAILY_URL;
  const timeoutMs = options.timeoutMs ?? 10_000;
  assertEcbUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // ECB serves XML; setting Accept is courtesy, not strictly required.
      headers: { Accept: 'application/xml' },
    });
    if (!res.ok) {
      throw new Error(`ecb.fetch: HTTP ${res.status}`);
    }
    const xml = await res.text();
    return parseEcbDailyXml(xml);
  } finally {
    clearTimeout(timer);
  }
}
