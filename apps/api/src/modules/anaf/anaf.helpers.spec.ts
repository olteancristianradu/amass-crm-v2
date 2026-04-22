import { describe, expect, it } from 'vitest';
import { anafBaseUrl, escapeXml, formatUblDate, mapAnafStatus } from './anaf.helpers';

describe('mapAnafStatus', () => {
  it('maps the three known statuses (case-insensitive)', () => {
    expect(mapAnafStatus('in prelucrare', 'PENDING')).toBe('IN_VALIDATION');
    expect(mapAnafStatus('OK', 'PENDING')).toBe('OK');
    expect(mapAnafStatus('NOK', 'PENDING')).toBe('NOK');
  });

  it('returns the fallback for unknown statuses (never crash the poller)', () => {
    expect(mapAnafStatus('completely_new_status', 'UPLOADED')).toBe('UPLOADED');
    expect(mapAnafStatus(undefined, 'FAILED')).toBe('FAILED');
    expect(mapAnafStatus('', 'FAILED')).toBe('FAILED');
  });
});

describe('escapeXml', () => {
  it('escapes all 5 required XML characters', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeXml('SRL Acme 2025')).toBe('SRL Acme 2025');
  });

  it('handles the Romanian apostrophe case used in company names', () => {
    expect(escapeXml("O'Connor & Fii")).toBe('O&apos;Connor &amp; Fii');
  });
});

describe('formatUblDate', () => {
  it('formats to YYYY-MM-DD', () => {
    expect(formatUblDate(new Date('2026-04-22T14:30:00Z'))).toBe('2026-04-22');
  });

  it('ignores time-of-day', () => {
    expect(formatUblDate(new Date('2026-04-22T23:59:59Z'))).toBe('2026-04-22');
  });
});

describe('anafBaseUrl', () => {
  it('returns sandbox URL for test submissions', () => {
    expect(anafBaseUrl(true)).toContain('/test/');
  });

  it('returns prod URL when sandbox=false', () => {
    expect(anafBaseUrl(false)).toContain('/prod/');
  });
});
