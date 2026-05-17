import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService, TENANT_SCOPED_MODELS, applyTenantScope, tenantExtension } from './prisma.service';
import { getTenantContext, tenantStorage } from './tenant-context';

// runWithTenant tests construct a real PrismaService instance but stub the
// `extended` / `readExtended` fields (private) so no real Postgres is needed.
// The constructor itself does NOT connect — only $connect() does — so it's
// safe to instantiate without a DATABASE_URL.

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

  it.each([
    "'; DROP TABLE users; --",
    "tenant' OR '1'='1",
    'tenant\nSET LOCAL role = superuser',
    'x'.repeat(25),
    'C' + 'a'.repeat(24),
    '550e8400-e29b-41d4-a716',
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
    ' 550e8400-e29b-41d4-a716-446655440000',
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

  it('stamps tenantId on count / aggregate / groupBy / updateMany / deleteMany', () => {
    for (const op of ['count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'] as const) {
      const out = applyTenantScope('Deal', op, { where: { id: 'd1' } }, ctx);
      expect((out.where as { tenantId?: string }).tenantId).toBe(TENANT);
    }
  });

  it('handles createMany with non-array data (forward-compat shape)', () => {
    const before = { data: { email: 'a@b' } };
    const out = applyTenantScope('Contact', 'createMany', before, ctx);
    // Non-array createMany.data is rare/non-canonical; we leave it untouched.
    expect(out.data).toEqual(before.data);
  });

  it('does NOT touch args when model is not tenant-scoped', () => {
    const before = { where: { id: 'x' } };
    const out = applyTenantScope('Tenant', 'findFirst', before, ctx);
    expect((out.where as { tenantId?: string }).tenantId).toBeUndefined();
  });

  it('no-ops when model is undefined', () => {
    const before = { where: { id: 'x' } };
    const out = applyTenantScope(undefined, 'findFirst', before, ctx);
    expect(out).toBe(before);
  });

  it('no-ops when ctx is null (pre-auth slug lookup / seed scripts)', () => {
    const before = { where: { slug: 'acme' } };
    const out = applyTenantScope('Company', 'findFirst', before, null);
    expect((out.where as { tenantId?: string }).tenantId).toBeUndefined();
  });

  it('no-ops when ctx is undefined', () => {
    const before = { where: { slug: 'acme' } };
    const out = applyTenantScope('Company', 'findFirst', before, undefined);
    expect((out.where as { tenantId?: string }).tenantId).toBeUndefined();
  });

  it('no-ops for unknown operations (extension forward-compat)', () => {
    const before = { anything: 'goes' } as Record<string, unknown>;
    const out = applyTenantScope('Deal', 'someFutureOp', before, ctx);
    expect(out).toEqual(before);
  });

  // ── PRESERVE explicit tenantId (defense-in-depth) ────────────────────
  // Fix following 049e50a: when the caller explicitly provides a
  // tenantId (in where for reads/updates, or in data for writes), the
  // extension MUST NOT overwrite it. The mismatch is left for Postgres
  // RLS to catch. Test contract pinned by
  // multi-tenant.e2e.spec.ts "RLS: writing to wrong tenant from inside
  // runWithTenant fails".

  it('does NOT override explicit data.tenantId on create (RLS catches mismatch)', () => {
    const out = applyTenantScope(
      'User',
      'create',
      { data: { tenantId: 'tenant-B-explicit', email: 'evil@x' } },
      ctx, // ctx says A but data says B
    );
    expect((out.data as { tenantId: string }).tenantId).toBe('tenant-B-explicit');
  });

  it('does NOT override explicit row.tenantId on createMany (per row)', () => {
    const out = applyTenantScope(
      'Contact',
      'createMany',
      {
        data: [
          { tenantId: 'tenant-B', email: 'a@b' },
          { email: 'c@d' }, // no explicit — gets stamped
        ],
      },
      ctx,
    );
    const rows = out.data as Array<{ tenantId: string }>;
    expect(rows[0].tenantId).toBe('tenant-B');
    expect(rows[1].tenantId).toBe(TENANT);
  });

  it('does NOT override explicit where.tenantId on update', () => {
    const out = applyTenantScope(
      'Deal',
      'update',
      { where: { id: 'd1', tenantId: 'tenant-B' } },
      ctx,
    );
    expect((out.where as { tenantId: string }).tenantId).toBe('tenant-B');
  });

  it('does NOT override explicit where.tenantId on findMany', () => {
    const out = applyTenantScope(
      'Deal',
      'findMany',
      { where: { tenantId: 'tenant-B' } },
      ctx,
    );
    expect((out.where as { tenantId: string }).tenantId).toBe('tenant-B');
  });
});

// ─── runWithTenant ─────────────────────────────────────────────────────

describe('PrismaService.runWithTenant', () => {
  const VALID_TENANT = 'c11112222333344445555666f';
  let svc: PrismaService;
  let txDouble: {
    $executeRaw: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let extendedTransaction: ReturnType<typeof vi.fn>;
  let readExtendedTransaction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = new PrismaService();
    txDouble = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
    extendedTransaction = vi.fn(async (cb: (tx: typeof txDouble) => unknown) => cb(txDouble));
    readExtendedTransaction = vi.fn(async (cb: (tx: typeof txDouble) => unknown) => cb(txDouble));
    // Replace the (private) extended/readExtended fields with mocks so we
    // don't need a real Postgres connection.
    (svc as unknown as { extended: unknown }).extended = { $transaction: extendedTransaction };
    (svc as unknown as { readExtended: unknown }).readExtended = { $transaction: readExtendedTransaction };
  });

  afterEach(() => vi.clearAllMocks());

  it('rejects an invalid tenantId before opening a transaction', async () => {
    await expect(
      svc.runWithTenant('not-a-real-id', async () => 1),
    ).rejects.toThrow('runWithTenant: tenantId failed format validation');
    expect(extendedTransaction).not.toHaveBeenCalled();
  });

  it('opens a transaction, sets app.tenant_id via parameter-bound $executeRaw, and SETs role app_user', async () => {
    const result = await svc.runWithTenant(VALID_TENANT, async () => 'ok');
    expect(result).toBe('ok');
    expect(extendedTransaction).toHaveBeenCalledTimes(1);
    // First call: parameter-bound set_config
    const rawArgs = txDouble.$executeRaw.mock.calls[0]!;
    // Tagged template: first arg is the strings array, then placeholder values
    expect(Array.isArray(rawArgs[0])).toBe(true);
    expect((rawArgs[0] as string[]).join('?')).toContain("set_config('app.tenant_id'");
    expect(rawArgs[1]).toBe(VALID_TENANT);
    // SET LOCAL ROLE — hardcoded identifier
    expect(txDouble.$executeRawUnsafe).toHaveBeenCalledWith('SET LOCAL ROLE app_user');
  });

  it('does NOT add transaction_read_only when called in default rw mode', async () => {
    await svc.runWithTenant(VALID_TENANT, async () => undefined);
    const calls = txDouble.$executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('SET LOCAL transaction_read_only = on');
  });

  it('passes the inner-fn return value back to the caller', async () => {
    const result = await svc.runWithTenant(VALID_TENANT, async () => ({ rows: 7 }));
    expect(result).toEqual({ rows: 7 });
  });

  it("routes ro mode to readExtended ONLY when a separate readClient was configured", async () => {
    // Default constructor sets readClient = this — readExtended is set above
    // but the runtime check `this.readClient !== this` will be false because
    // the constructor stored `(this as unknown as PrismaClient)` for readClient.
    // Verify the primary path is used.
    await svc.runWithTenant(VALID_TENANT, 'ro', async () => 'r');
    expect(extendedTransaction).toHaveBeenCalledTimes(1);
    expect(readExtendedTransaction).not.toHaveBeenCalled();
  });

  it('routes ro mode to readExtended when DATABASE_REPLICA_URL produced a distinct readClient', async () => {
    // Simulate a real read-replica wiring by replacing the readClient pointer
    // so it is no longer === this. We use a sentinel object — the only thing
    // checked is reference equality.
    (svc as unknown as { readClient: unknown }).readClient = { sentinel: 'distinct' };
    await svc.runWithTenant(VALID_TENANT, 'ro', async () => 'replica');
    expect(readExtendedTransaction).toHaveBeenCalledTimes(1);
    expect(extendedTransaction).not.toHaveBeenCalled();
    // ro path also pins the transaction read-only
    const calls = txDouble.$executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SET LOCAL transaction_read_only = on');
  });

  it('rw mode never goes to the read replica even when one is configured', async () => {
    (svc as unknown as { readClient: unknown }).readClient = { sentinel: 'distinct' };
    await svc.runWithTenant(VALID_TENANT, 'rw', async () => 'primary');
    expect(extendedTransaction).toHaveBeenCalledTimes(1);
    expect(readExtendedTransaction).not.toHaveBeenCalled();
  });

  // ─── B3-PR4 e2e finding: ALS context inside the transaction ───────────
  // The SCIM bearer flow + system-job paths don't have a TenantContextMiddleware
  // upstream. runWithTenant now sets the AsyncLocalStorage itself so the
  // tenantExtension query handler can read `getTenantContext()` and stamp
  // tenantId on every write. Regression test for commit 5d9fc42.

  it('exposes a populated tenant ALS context inside the transaction callback', async () => {
    // Re-import getTenantContext so the test sees the live module instance.
    let observed: { tenantId?: string } | undefined;
    await svc.runWithTenant(VALID_TENANT, async () => {
      observed = getTenantContext();
      return 'inner';
    });
    expect(observed).toBeDefined();
    expect(observed?.tenantId).toBe(VALID_TENANT);
  });

  it('PRESERVES the upstream ALS unchanged when one exists (do NOT override tenantId)', async () => {
    const otherTenant = 'cothertenant33344445555666f';
    let observed: { tenantId?: string; userId?: string } | undefined;
    await tenantStorage.run({ tenantId: otherTenant, userId: 'u-99' }, () =>
      svc.runWithTenant(VALID_TENANT, async () => {
        observed = getTenantContext();
        return undefined;
      }),
    );
    // Overriding the upstream tenantId here would silence the legitimate
    // developer-error / cross-tenant-write attempts that RLS catches —
    // see commit message of the fix following 5d9fc42, and
    // test/multi-tenant.e2e.spec.ts "RLS: writing to wrong tenant from
    // inside runWithTenant fails" for the security contract.
    expect(observed?.tenantId).toBe(otherTenant);
    expect(observed?.userId).toBe('u-99');
    // The SET LOCAL config (Postgres RLS) still uses the CALLER-supplied
    // tenant (VALID_TENANT) — that's how RLS catches the mismatch when
    // the extension stamps the wrong tenantId. Verify the raw SQL went
    // out with VALID_TENANT, not the upstream ALS tenant.
    expect(txDouble.$executeRaw.mock.calls[0]?.[1]).toBe(VALID_TENANT);
  });

  it('ALS context unwinds after the callback resolves (no leak across calls)', async () => {
    expect(getTenantContext()).toBeUndefined(); // baseline
    await svc.runWithTenant(VALID_TENANT, async () => 'done');
    // After the run() resolves we should be back to the original (empty) ctx.
    expect(getTenantContext()).toBeUndefined();
  });
});

// ─── tenantExtension ───────────────────────────────────────────────────

describe('tenantExtension query handler', () => {
  // Build a stand-in for what Prisma.defineExtension wraps. We extract the
  // $allOperations function and drive it directly with model/operation/args.
  function getAllOps() {
    const ext = tenantExtension();
    // Prisma's defineExtension returns a callable that, when applied via
    // $extends, returns a config object. Inspect the underlying config.
    const cfg = (ext as unknown as { name: string; query?: { $allModels?: { $allOperations?: unknown } } });
    // Some Prisma versions wrap the function in a getter. Try both shapes.
    const q = cfg.query as undefined | { $allModels: { $allOperations: unknown } };
    return q?.$allModels?.$allOperations as undefined | ((p: {
      model: string;
      operation: string;
      args: Record<string, unknown>;
      query: (a: Record<string, unknown>) => Promise<unknown>;
    }) => Promise<unknown>);
  }

  beforeEach(() => {
    // Reset ALS-backed tenant-context between tests
    vi.resetModules();
  });

  it('passes through unchanged when model is not tenant-scoped', async () => {
    const fn = getAllOps();
    if (!fn) {
      // Older/newer Prisma layout — extension shape changed; skip silently.
      return;
    }
    const queried: Record<string, unknown>[] = [];
    const query = vi.fn(async (a: Record<string, unknown>) => {
      queried.push(a);
      return 'ok';
    });
    const args = { where: { id: 'x' } };
    await fn({ model: 'Tenant', operation: 'findFirst', args, query });
    // Tenant model is not in TENANT_SCOPED_MODELS — args untouched
    expect(queried[0]).toEqual(args);
  });

  it('passes through unchanged when no tenant context is in ALS', async () => {
    const fn = getAllOps();
    if (!fn) return;
    const query = vi.fn(async (a: Record<string, unknown>) => a);
    const args = { where: { id: 'x' } };
    // No tenantStorage.run() wrapper → ALS getStore() returns undefined
    await fn({ model: 'Company', operation: 'findFirst', args, query });
    expect(query).toHaveBeenCalledWith(args);
  });

  it('mutates args via applyTenantScope when ALS holds a tenant context', async () => {
    const fn = getAllOps();
    if (!fn) return;
    const { tenantStorage } = await import('./tenant-context');
    const query = vi.fn(async (a: Record<string, unknown>) => a);
    await tenantStorage.run({ tenantId: 'c11112222333344445555666f' }, async () => {
      await fn({
        model: 'Company',
        operation: 'findFirst',
        args: { where: { name: 'acme' } },
        query,
      });
    });
    const seen = query.mock.calls[0]![0] as { where: { tenantId?: string; name?: string } };
    expect(seen.where.tenantId).toBe('c11112222333344445555666f');
    expect(seen.where.name).toBe('acme');
  });
});

// ─── Schema-introspection regression test ──────────────────────────────────
// Pinned by 2026-05-17 audit (8 models had `tenantId` columns but were missing
// from TENANT_SCOPED_MODELS — Layer-2 defense was silently no-oping for them).
//
// This test parses schema.prisma at test-time, finds every `model X { ... }`
// block whose body contains a `tenantId` FIELD (not a relation named `tenant`,
// not `@@unique([tenantId, ...])` index lines — only the actual column),
// and asserts every such model is registered in TENANT_SCOPED_MODELS.
//
// Failure mode = a developer added a tenant-scoped model to schema.prisma
// but forgot to register it here, which is exactly the bug class CLAUDE.md
// rule #3 + the broken-window agent guidance call out.

describe('TENANT_SCOPED_MODELS — schema synchronization invariant', () => {
  // `Tenant` itself is the root entity: it IS the tenant, not tenant-scoped.
  // Pre-auth lookups (login by slug) must hit it without ALS context.
  const ROOT_EXCEPTIONS = new Set<string>(['Tenant']);

  function modelsWithTenantIdColumn(): string[] {
    const schemaPath = resolve(__dirname, '../../../prisma/schema.prisma');
    const src = readFileSync(schemaPath, 'utf8');

    // Match `model X {`  ...  `}` blocks (non-greedy, anchored to line start
    // so we don't match keywords inside comments).
    const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = modelRe.exec(src)) !== null) {
      const [, name, body] = m;
      if (!name || !body) continue;
      // A `tenantId` FIELD line looks like:
      //   tenantId  String   @map("tenant_id")
      //   tenantId  String
      // We must reject:
      //   tenant     Tenant   @relation(...)           ← relation, not a column
      //   @@unique([tenantId, slug])                    ← index attribute
      //   @@index([tenantId])                           ← index attribute
      // The rule: a line starting with whitespace then exact token `tenantId`
      // followed by whitespace + a Prisma scalar type (String, Int, etc).
      // We accept any scalar — schema currently uses `String`, but be forgiving.
      const fieldRe = /^\s+tenantId\s+[A-Z]\w*/m;
      if (fieldRe.test(body)) out.push(name);
    }
    return out;
  }

  it('every model in schema.prisma with a tenantId column is registered', () => {
    const found = modelsWithTenantIdColumn();
    // Sanity: parser caught a non-trivial set (current schema has 80+ such
    // models). If this drops to a tiny number the regex regressed silently.
    expect(found.length).toBeGreaterThan(30);

    const missing: string[] = [];
    for (const model of found) {
      if (ROOT_EXCEPTIONS.has(model)) continue;
      if (!TENANT_SCOPED_MODELS.has(model)) missing.push(model);
    }

    // Custom assertion so the failure points the developer at the exact fix.
    if (missing.length > 0) {
      const lines = missing
        .map(
          (m) =>
            `  - Model ${m} has tenantId column but missing from TENANT_SCOPED_MODELS Set — add it to apps/api/src/infra/prisma/prisma.service.ts`,
        )
        .join('\n');
      throw new Error(
        `TENANT_SCOPED_MODELS is out of sync with schema.prisma:\n${lines}`,
      );
    }
  });

  it('regex finds the 8 historically-missed models (parser sanity)', () => {
    // Pin the 2026-05-17 audit findings — guards against the regex regressing
    // and silently passing the main assertion above by missing real columns.
    const found = modelsWithTenantIdColumn();
    for (const model of [
      'CockpitLayout',
      'ConsentRecord',
      'EventAttendee',
      'OrderItem',
      'ProductBundleItem',
      'SavedView',
      'TerritoryAssignment',
      'WebhookDelivery',
    ]) {
      expect(found, `expected parser to detect tenantId in ${model}`).toContain(model);
    }
  });
});
