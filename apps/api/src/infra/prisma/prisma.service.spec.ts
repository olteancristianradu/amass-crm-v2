import { describe, expect, it } from 'vitest';
import { PrismaService } from './prisma.service';

describe('PrismaService.isValidTenantId', () => {
  it('accepts a canonical cuid', () => {
    expect(PrismaService.isValidTenantId('clx1abc2def3ghi4jkl5mno6p')).toBe(true);
  });

  it('accepts UUID v4', () => {
    expect(PrismaService.isValidTenantId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts upper-case UUID', () => {
    expect(PrismaService.isValidTenantId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects empty / wrong type', () => {
    expect(PrismaService.isValidTenantId('')).toBe(false);
    expect(PrismaService.isValidTenantId(undefined)).toBe(false);
    expect(PrismaService.isValidTenantId(null)).toBe(false);
    expect(PrismaService.isValidTenantId(42)).toBe(false);
    expect(PrismaService.isValidTenantId({ id: 'abc' })).toBe(false);
  });

  // These are the reason the allow-list exists — any of these slipping
  // through would break out of the single-quote escaping in SET LOCAL.
  it.each([
    "'; DROP TABLE users; --",
    "tenant' OR '1'='1",
    'tenant\nSET LOCAL role = superuser',
    'x'.repeat(25),               // right length for cuid but missing leading `c`
    'C' + 'a'.repeat(24),         // upper-case leading letter is not allowed
    '550e8400-e29b-41d4-a716',    // truncated UUID
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', // hex-only, but z is not hex
    ' 550e8400-e29b-41d4-a716-446655440000', // leading space
  ])('rejects %s', (input) => {
    expect(PrismaService.isValidTenantId(input)).toBe(false);
  });
});
