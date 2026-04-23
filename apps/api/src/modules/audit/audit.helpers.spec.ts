import { describe, expect, it } from 'vitest';
import type { AuditLog } from '@prisma/client';
import { buildSiemPayload, computeRetentionCutoff, sliceCursorPage } from './audit.helpers';

describe('computeRetentionCutoff', () => {
  const now = new Date('2026-04-22T12:00:00.000Z');

  it('returns null for 0 days (retention disabled)', () => {
    expect(computeRetentionCutoff(0, now)).toBeNull();
  });

  it('returns null for negative days (guard against config typos)', () => {
    expect(computeRetentionCutoff(-10, now)).toBeNull();
  });

  it('returns null for NaN / Infinity', () => {
    expect(computeRetentionCutoff(NaN, now)).toBeNull();
    expect(computeRetentionCutoff(Infinity, now)).toBeNull();
  });

  it('subtracts the window in milliseconds (365 days)', () => {
    const cutoff = computeRetentionCutoff(365, now)!;
    expect(cutoff.toISOString()).toBe('2025-04-22T12:00:00.000Z');
  });
});

describe('buildSiemPayload', () => {
  const row: AuditLog = {
    id: 'audit-1',
    tenantId: 'tenant-1',
    actorId: 'user-1',
    action: 'deal.create',
    subjectType: 'Deal',
    subjectId: 'deal-1',
    ipAddress: '10.0.0.1',
    userAgent: 'ua',
    metadata: { value: 1000 },
    createdAt: new Date('2026-04-22T12:00:00.000Z'),
  };

  it('stringifies createdAt as ISO-8601', () => {
    expect(buildSiemPayload('tenant-1', row).createdAt).toBe('2026-04-22T12:00:00.000Z');
  });

  it('passes metadata through untouched', () => {
    expect(buildSiemPayload('tenant-1', row).metadata).toEqual({ value: 1000 });
  });

  it('uses the explicit tenantId argument (not the row field) so system jobs can override', () => {
    const payload = buildSiemPayload('override-tenant', { ...row, tenantId: 'different' });
    expect(payload.tenantId).toBe('override-tenant');
  });
});

describe('sliceCursorPage', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns nextCursor=null when fewer rows than limit', () => {
    expect(sliceCursorPage(rows, 10)).toEqual({ data: rows, nextCursor: null });
  });

  it('returns nextCursor=<last> and drops the +1 row when more pages exist', () => {
    // limit=2 means we fetched 3 (limit+1) and the last is a peek-ahead
    expect(sliceCursorPage(rows, 2)).toEqual({ data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
  });

  it('empty input → empty page, no cursor', () => {
    expect(sliceCursorPage([], 20)).toEqual({ data: [], nextCursor: null });
  });
});
