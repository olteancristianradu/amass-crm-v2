import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScimTokenService } from './scim-token.service';

/**
 * Unit tests for ScimTokenService.
 *
 * We mock the Prisma client so:
 *   - `runWithTenant(tenantId, fn)` invokes `fn(tx)` synchronously, filtering
 *     in-memory rows by `tenantId` to reproduce the tenant extension.
 *   - `prisma.scimToken.findUnique({ where: { tokenHash } })` is a global
 *     lookup (no tenant context — that's what verifyToken needs to discover
 *     the tenant in the first place).
 */

interface FakeRow {
  id: string;
  tenantId: string;
  name: string;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

function buildPrismaMock(seed: FakeRow[] = []) {
  const store: FakeRow[] = [...seed];
  let nextId = 1;

  function makeTx(activeTenant: string) {
    const filterByTenant = (where: Record<string, unknown> | undefined) => {
      const w = where ?? {};
      return store.filter((r) => {
        if (r.tenantId !== activeTenant) return false;
        if (typeof w.id === 'string' && r.id !== w.id) return false;
        return true;
      });
    };
    return {
      scimToken: {
        findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
          filterByTenant(where).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
        findFirst: vi.fn(
          async ({ where }: { where?: Record<string, unknown> } = {}) => filterByTenant(where)[0] ?? null,
        ),
        create: vi.fn(async ({ data }: { data: { name: string; tokenHash: string } }) => {
          const row: FakeRow = {
            id: `tok_${nextId++}`,
            tenantId: activeTenant,
            name: data.name,
            tokenHash: data.tokenHash,
            createdAt: new Date(),
            lastUsedAt: null,
            revokedAt: null,
          };
          store.push(row);
          return row;
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
            const row = store.find((r) => r.id === where.id);
            if (!row) throw new Error('not found');
            Object.assign(row, data);
            return row;
          },
        ),
      },
    };
  }

  // Top-level scimToken — used by verifyToken (NO tenant filter, since we
  // don't know the tenant yet at that point).
  return {
    runWithTenant: vi.fn(async (tenantId: string, fn: (tx: ReturnType<typeof makeTx>) => unknown) =>
      fn(makeTx(tenantId)),
    ),
    scimToken: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
        store.find((r) => r.tokenHash === where.tokenHash) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
        const row = store.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    _store: store,
  };
}

describe('ScimTokenService.hash', () => {
  it('is stable and produces a 64-char hex digest (SHA-256)', () => {
    const a = ScimTokenService.hash('abc');
    const b = ScimTokenService.hash('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different inputs produce different hashes', () => {
    expect(ScimTokenService.hash('a')).not.toBe(ScimTokenService.hash('b'));
  });
});

describe('ScimTokenService.create + verifyToken round-trip', () => {
  it('returns a raw token that verifies back to the same tenant + token id', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);

    const created = await svc.create('tenant-A', 'Okta production');
    expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(created.token.length).toBeGreaterThan(40); // ~43 chars for 32 bytes
    expect(created.name).toBe('Okta production');

    const verified = await svc.verifyToken(created.token);
    expect(verified).not.toBeNull();
    expect(verified!.tenantId).toBe('tenant-A');
    expect(verified!.tokenId).toBe(created.id);
  });

  it('verifyToken returns null for a random / unknown token', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    await svc.create('tenant-A', 'x');
    const verified = await svc.verifyToken('not-a-real-token');
    expect(verified).toBeNull();
  });

  it('verifyToken returns null for empty / non-string input', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    expect(await svc.verifyToken('')).toBeNull();
    // Pass through `unknown` channel to simulate a runtime non-string.
    expect(await svc.verifyToken(null as unknown as string)).toBeNull();
  });
});

describe('ScimTokenService.verifyToken with revoked + lastUsedAt', () => {
  it('returns null after the token is revoked', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    const created = await svc.create('tenant-A', 'soon-to-be-revoked');
    expect(await svc.verifyToken(created.token)).not.toBeNull();

    await svc.revoke('tenant-A', created.id);
    expect(await svc.verifyToken(created.token)).toBeNull();
  });

  it('bumps lastUsedAt on successful verify (best-effort fire-and-forget)', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    const created = await svc.create('tenant-A', 'with-last-used');
    const before = (prisma as ReturnType<typeof buildPrismaMock>)._store[0]!.lastUsedAt;
    expect(before).toBeNull();

    await svc.verifyToken(created.token);
    // The verify call schedules a fire-and-forget update; wait a microtask
    // tick so the catch-handler chain settles before we assert.
    await new Promise((r) => setImmediate(r));

    const after = (prisma as ReturnType<typeof buildPrismaMock>)._store[0]!.lastUsedAt;
    expect(after).not.toBeNull();
    expect(after).toBeInstanceOf(Date);
  });
});

describe('ScimTokenService multi-tenant isolation', () => {
  it('a tenant-A token authenticates as tenant-A (NOT tenant-B), even if tenant-B has its own tokens', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);

    const tokenA = await svc.create('tenant-A', 'A integration');
    const tokenB = await svc.create('tenant-B', 'B integration');

    // Round-trip both: each must resolve to its OWN tenant.
    const verA = await svc.verifyToken(tokenA.token);
    const verB = await svc.verifyToken(tokenB.token);
    expect(verA).toEqual({ tenantId: 'tenant-A', tokenId: tokenA.id });
    expect(verB).toEqual({ tenantId: 'tenant-B', tokenId: tokenB.id });
    expect(verA!.tenantId).not.toBe(verB!.tenantId);

    // And listing tenant-A returns ONLY tenant-A tokens (NOT tenant-B's).
    // This proves the tenant-scoped store filter is engaged — defense in
    // depth on top of the tenantExtension + RLS that production uses.
    const listA = await svc.list('tenant-A');
    expect(listA).toHaveLength(1);
    expect(listA[0]!.id).toBe(tokenA.id);
    expect(listA[0]!.name).toBe('A integration');
  });
});

describe('ScimTokenService.list', () => {
  it('returns metadata only — never the raw token or the hash', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    await svc.create('tenant-A', 'one');
    await svc.create('tenant-A', 'two');

    const list = await svc.list('tenant-A');
    expect(list).toHaveLength(2);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'id', 'lastUsedAt', 'name', 'revokedAt'].sort(),
      );
      // Defensive: even if "tokenHash" were present, fail loudly.
      expect((row as Record<string, unknown>).tokenHash).toBeUndefined();
      expect((row as Record<string, unknown>).token).toBeUndefined();
    }
  });

  it('includes revoked tokens (admin needs to see the full history)', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    const tok = await svc.create('tenant-A', 'will-revoke');
    await svc.revoke('tenant-A', tok.id);
    const list = await svc.list('tenant-A');
    expect(list).toHaveLength(1);
    expect(list[0]!.revokedAt).toBeInstanceOf(Date);
  });
});

describe('ScimTokenService.revoke', () => {
  it('sets revokedAt = now on the matching row', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    const tok = await svc.create('tenant-A', 'to-revoke');
    const before = Date.now() - 1;
    const result = await svc.revoke('tenant-A', tok.id);
    expect(result.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('is idempotent — revoking twice keeps the same revokedAt', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    const tok = await svc.create('tenant-A', 'twice');
    const first = await svc.revoke('tenant-A', tok.id);
    const second = await svc.revoke('tenant-A', tok.id);
    expect(second.revokedAt.toISOString()).toBe(first.revokedAt.toISOString());
  });

  it('throws NotFound when the id is not in this tenant', async () => {
    const prisma = buildPrismaMock();
    const svc = new ScimTokenService(prisma as never);
    const tok = await svc.create('tenant-A', 'foreign');
    // Looking up tenant-A's token from tenant-B's context must fail.
    await expect(svc.revoke('tenant-B', tok.id)).rejects.toThrow(NotFoundException);
  });
});
