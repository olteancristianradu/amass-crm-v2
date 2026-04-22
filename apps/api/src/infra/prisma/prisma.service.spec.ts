import { describe, expect, it } from 'vitest';
import { PrismaService, applyTenantScope } from './prisma.service';

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

/**
 * Layer-2 defense-in-depth: applyTenantScope is the pure mutation rule the
 * Prisma extension delegates to. Tests drive it directly so we don't have
 * to spin up a Prisma client or ALS context in unit tests.
 */
describe('applyTenantScope — Layer 2 auto-inject tenantId', () => {
  const TENANT = 'c11112222333344445555666f';
  const ctx = { tenantId: TENANT };

  it('injects tenantId into findMany.where for a tenant-scoped model', () => {
    const out = applyTenantScope('Company', 'findMany', { where: { name: 'acme' } }, ctx);
    expect((out.where as { tenantId?: string; name?: string }).tenantId).toBe(TENANT);
    expect((out.where as { name?: string }).name).toBe('acme');
  });

  it('injects tenantId into create.data', () => {
    const out = applyTenantScope('Deal', 'create', { data: { title: 'x' } }, ctx);
    expect((out.data as { tenantId?: string }).tenantId).toBe(TENANT);
  });

  it('injects tenantId on every row of createMany', () => {
    const out = applyTenantScope(
      'Contact',
      'createMany',
      { data: [{ email: 'a@b' }, { email: 'c@d' }] },
      ctx,
    );
    for (const row of out.data as Array<{ tenantId?: string }>) {
      expect(row.tenantId).toBe(TENANT);
    }
  });

  it('stamps tenantId on update/delete/upsert where clauses', () => {
    for (const op of ['update', 'delete', 'upsert'] as const) {
      const out = applyTenantScope('Deal', op, { where: { id: 'd1' } }, ctx);
      expect((out.where as { tenantId?: string }).tenantId).toBe(TENANT);
    }
  });

  it('does NOT touch args when model is not tenant-scoped', () => {
    const before = { where: { id: 'x' } };
    const out = applyTenantScope('Tenant', 'findFirst', before, ctx);
    expect((out.where as { tenantId?: string }).tenantId).toBeUndefined();
  });

  it('no-ops when ctx is null (pre-auth slug lookup / seed scripts)', () => {
    const before = { where: { slug: 'acme' } };
    const out = applyTenantScope('Company', 'findFirst', before, null);
    expect((out.where as { tenantId?: string }).tenantId).toBeUndefined();
  });

  it('no-ops for unknown operations (extension forward-compat)', () => {
    const before = { anything: 'goes' } as Record<string, unknown>;
    const out = applyTenantScope('Deal', 'someFutureOp', before, ctx);
    expect(out).toEqual(before);
  });
});
