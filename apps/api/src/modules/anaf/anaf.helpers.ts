/**
 * Pure helpers for the ANAF e-Factura flow. Extracted so the tricky bits
 * (status mapping, XML escaping) can be unit-tested without hitting
 * Postgres or the ANAF sandbox.
 */

import type { AnafSubmissionStatus } from '@prisma/client';

/**
 * ANAF SPV response codes → our internal submission status. ANAF emits
 * Romanian-language strings; we case-insensitive match them. "xml" is
 * returned on `stareMesaj` when the validation finishes successfully —
 * we treat it the same as "ok".
 */
export const ANAF_STATUS_MAP: Record<string, AnafSubmissionStatus> = {
  'in prelucrare': 'IN_VALIDATION',
  'ok': 'OK',
  'nok': 'NOK',
};

export function mapAnafStatus(raw: string | undefined, fallback: AnafSubmissionStatus): AnafSubmissionStatus {
  if (!raw) return fallback;
  return ANAF_STATUS_MAP[raw.toLowerCase()] ?? fallback;
}

/**
 * Minimal XML escape for UBL 2.1 bodies. We only emit values we've
 * constructed (invoice fields, line items) so we cover the 5 mandatory
 * characters per the XML spec — no need for a full parser.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format a JS Date to `YYYY-MM-DD` (UBL-required). */
export function formatUblDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Sandbox/prod URL selector. Both share the same path, only host differs. */
export function anafBaseUrl(sandbox: boolean): string {
  return sandbox
    ? 'https://api.anaf.ro/test/FCTEL/rest'
    : 'https://api.anaf.ro/prod/FCTEL/rest';
}
