import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScimService } from './scim.service';
import { SCIM_USER_SCHEMA_URN } from './scim.dto';

/**
 * Unit tests for ScimService. We mock the Prisma client so:
 *   - `runWithTenant(tenantId, fn)` invokes `fn(tx)` synchronously, BUT
 *     before doing so it filters the in-memory test rows by `tenantId`
 *     itself. This reproduces the production behavior of the tenant
 *     extension and lets us assert cross-tenant isolation.
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'usr_1',
    tenantId: 'tenant-A',
    email: 'a@example.com',
    emailVerifiedAt: null,
    passwordHash: 'h',
    fullName: 'Alice Smith',
    role: UserRole.VIEWER,
    isActive: true,
    totpSecret: null,
    totpEnabled: false,
    totpBackupCodes: null,
    completedTours: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build a fake PrismaService whose `runWithTenant` simulates the tenant
 * extension: every `tx.user.*` call automatically filters/stamps tenantId
 * on the active tenant. This is the closest we can get to integration-test
 * behavior without spinning up Postgres.
 */
function buildPrismaMock(seedUsers: User[]) {
  // Mutable copy so create/update can affect it.
  let store: User[] = [...seedUsers];

  function makeTx(activeTenant: string) {
    const filterByTenant = (where: Record<string, unknown> | undefined) => {
      const w = where ?? {};
      return store.filter((u) => {
        if (u.tenantId !== activeTenant) return false;
        if (typeof w.id === 'string' && u.id !== w.id) return false;
        if (typeof w.email === 'string' && u.email !== w.email) return false;
        return true;
      });
    };
    return {
      user: {
        count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
          filterByTenant(where).length,
        ),
        findMany: vi.fn(
          async ({
            where,
            skip = 0,
            take,
          }: { where?: Record<string, unknown>; skip?: number; take?: number } = {}) => {
            const all = filterByTenant(where).sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
            );
            return all.slice(skip, take !== undefined ? skip + take : undefined);
          },
        ),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
          return filterByTenant(where)[0] ?? null;
        }),
        create: vi.fn(async ({ data }: { data: Partial<User> }) => {
          const row: User = makeUser({
            id: `usr_${Math.random().toString(36).slice(2, 9)}`,
            tenantId: activeTenant, // simulate extension stamping tenantId
            email: data.email!,
            fullName: data.fullName ?? '',
            isActive: data.isActive ?? true,
            role: (data.role as UserRole) ?? UserRole.VIEWER,
            passwordHash: data.passwordHash ?? 'h',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          store.push(row);
          return row;
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
            const idx = store.findIndex(
              (u) => u.id === where.id && u.tenantId === activeTenant,
            );
            if (idx === -1) throw new Error('not found');
            store[idx] = { ...store[idx]!, ...data, updatedAt: new Date() };
            return store[idx]!;
          },
        ),
      },
    };
  }

  type Tx = ReturnType<typeof makeTx>;
  const prisma = {
    runWithTenant: vi.fn(async (tenantId: string, fn: (tx: Tx) => Promise<unknown>) => {
      return fn(makeTx(tenantId));
    }),
    _store: () => store,
    _reset: (s: User[]) => {
      store = [...s];
    },
  };
  return prisma as unknown as ConstructorParameters<typeof ScimService>[0] & {
    runWithTenant: ReturnType<typeof vi.fn>;
    _store: () => User[];
    _reset: (s: User[]) => void;
  };
}

describe('ScimService.listUsers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a SCIM ListResponse envelope with totalResults and itemsPerPage', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', email: 'a@x.com', tenantId: 'tenant-A' }),
      makeUser({ id: 'u2', email: 'b@x.com', tenantId: 'tenant-A' }),
    ]);
    const svc = new ScimService(prisma);
    const out = await svc.listUsers('tenant-A', 1, 50);
    expect(out.schemas[0]).toBe('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(out.totalResults).toBe(2);
    expect(out.startIndex).toBe(1);
    expect(out.itemsPerPage).toBe(2);
    expect(out.Resources).toHaveLength(2);
    expect(out.Resources[0]!.schemas).toContain(SCIM_USER_SCHEMA_URN);
  });

  it('paginates with startIndex/count', async () => {
    const seed = Array.from({ length: 5 }, (_, i) =>
      makeUser({
        id: `u${i}`,
        email: `u${i}@x.com`,
        tenantId: 'tenant-A',
        createdAt: new Date(2026, 0, 1 + i),
      }),
    );
    const svc = new ScimService(buildPrismaMock(seed));
    const page = await svc.listUsers('tenant-A', 3, 2);
    expect(page.totalResults).toBe(5);
    expect(page.startIndex).toBe(3);
    expect(page.itemsPerPage).toBe(2);
    expect(page.Resources.map((r) => r.id)).toEqual(['u2', 'u3']);
  });

  it('returns 400 on an unsupported filter', async () => {
    const svc = new ScimService(buildPrismaMock([]));
    await expect(svc.listUsers('tenant-A', 1, 50, 'active eq true')).rejects.toThrow(
      HttpException,
    );
    // Also confirm it's a 400 with the SCIM error envelope.
    try {
      await svc.listUsers('tenant-A', 1, 50, 'active eq true');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(400);
      const body = (err as HttpException).getResponse() as { scimType: string };
      expect(body.scimType).toBe('invalidFilter');
    }
  });

  it('applies a `userName eq` filter', async () => {
    const svc = new ScimService(
      buildPrismaMock([
        makeUser({ id: 'u1', email: 'alice@x.com', tenantId: 'tenant-A' }),
        makeUser({ id: 'u2', email: 'bob@x.com', tenantId: 'tenant-A' }),
      ]),
    );
    const out = await svc.listUsers('tenant-A', 1, 50, 'userName eq "alice@x.com"');
    expect(out.totalResults).toBe(1);
    expect(out.Resources[0]!.userName).toBe('alice@x.com');
  });

  // CRITICAL multi-tenant isolation test.
  it('does NOT return another tenant\'s rows', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'a1', email: 'a1@x.com', tenantId: 'tenant-A' }),
      makeUser({ id: 'b1', email: 'b1@x.com', tenantId: 'tenant-B' }),
      makeUser({ id: 'b2', email: 'b2@x.com', tenantId: 'tenant-B' }),
    ]);
    const svc = new ScimService(prisma);

    const a = await svc.listUsers('tenant-A', 1, 50);
    expect(a.totalResults).toBe(1);
    expect(a.Resources.map((r) => r.id)).toEqual(['a1']);

    const b = await svc.listUsers('tenant-B', 1, 50);
    expect(b.totalResults).toBe(2);
    expect(b.Resources.map((r) => r.id).sort()).toEqual(['b1', 'b2']);

    // Confirm runWithTenant was invoked with each tenant id — proof that
    // isolation is enforced at the runWithTenant boundary (not by service
    // code passing tenantId around manually).
    const calls = (prisma.runWithTenant as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0]![0]).toBe('tenant-A');
    expect(calls[1]![0]).toBe('tenant-B');
  });
});

describe('ScimService.getUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the SCIM envelope when the user exists in the tenant', async () => {
    const svc = new ScimService(
      buildPrismaMock([makeUser({ id: 'u1', tenantId: 'tenant-A' })]),
    );
    const out = await svc.getUser('tenant-A', 'u1');
    expect(out.id).toBe('u1');
  });

  it('throws 404 when the user does not exist', async () => {
    const svc = new ScimService(buildPrismaMock([]));
    await expect(svc.getUser('tenant-A', 'ghost')).rejects.toThrow(NotFoundException);
  });

  it('throws 404 when the user belongs to a different tenant', async () => {
    const svc = new ScimService(
      buildPrismaMock([makeUser({ id: 'u1', tenantId: 'tenant-B' })]),
    );
    await expect(svc.getUser('tenant-A', 'u1')).rejects.toThrow(NotFoundException);
  });
});

describe('ScimService.createUser', () => {
  beforeEach(() => vi.clearAllMocks());

  const dto = {
    schemas: [SCIM_USER_SCHEMA_URN],
    userName: 'new@x.com',
    name: { givenName: 'New', familyName: 'User' },
    emails: [{ value: 'new@x.com', primary: true }],
    active: true,
  };

  it('creates a new user and returns the SCIM envelope', async () => {
    const svc = new ScimService(buildPrismaMock([]));
    const out = await svc.createUser('tenant-A', dto);
    expect(out.userName).toBe('new@x.com');
    expect(out.active).toBe(true);
  });

  it('returns 409 on duplicate userName within the tenant', async () => {
    const svc = new ScimService(
      buildPrismaMock([makeUser({ email: 'new@x.com', tenantId: 'tenant-A' })]),
    );
    await expect(svc.createUser('tenant-A', dto)).rejects.toThrow(ConflictException);
  });
});

describe('ScimService.replaceUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('overwrites mutable fields', async () => {
    const svc = new ScimService(
      buildPrismaMock([
        makeUser({ id: 'u1', email: 'old@x.com', fullName: 'Old Name', tenantId: 'tenant-A' }),
      ]),
    );
    const out = await svc.replaceUser('tenant-A', 'u1', {
      schemas: [SCIM_USER_SCHEMA_URN],
      userName: 'new@x.com',
      name: { givenName: 'New', familyName: 'Name' },
      emails: [{ value: 'new@x.com', primary: true }],
      active: false,
    });
    expect(out.userName).toBe('new@x.com');
    expect(out.active).toBe(false);
  });

  it('throws 404 when target id is missing', async () => {
    const svc = new ScimService(buildPrismaMock([]));
    await expect(
      svc.replaceUser('tenant-A', 'ghost', {
        schemas: [SCIM_USER_SCHEMA_URN],
        userName: 'a@x.com',
        name: { givenName: 'A', familyName: 'B' },
        emails: [{ value: 'a@x.com', primary: true }],
        active: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ScimService.patchUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces active=false', async () => {
    const svc = new ScimService(
      buildPrismaMock([makeUser({ id: 'u1', isActive: true, tenantId: 'tenant-A' })]),
    );
    const out = await svc.patchUser('tenant-A', 'u1', [
      { op: 'replace', path: 'active', value: false },
    ]);
    expect(out.active).toBe(false);
  });

  it('throws 400 on unsupported op (add)', async () => {
    const svc = new ScimService(
      buildPrismaMock([makeUser({ id: 'u1', tenantId: 'tenant-A' })]),
    );
    await expect(
      svc.patchUser('tenant-A', 'u1', [{ op: 'add', path: 'active', value: false }]),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 404 on missing user', async () => {
    const svc = new ScimService(buildPrismaMock([]));
    await expect(
      svc.patchUser('tenant-A', 'ghost', [{ op: 'replace', path: 'active', value: false }]),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ScimService.deleteUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-deletes by setting isActive=false', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', isActive: true, tenantId: 'tenant-A' }),
    ]);
    const svc = new ScimService(prisma);
    await svc.deleteUser('tenant-A', 'u1');
    const remaining = prisma._store().find((u) => u.id === 'u1');
    expect(remaining?.isActive).toBe(false);
  });

  it('is idempotent on already-deleted users', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', isActive: false, tenantId: 'tenant-A' }),
    ]);
    const svc = new ScimService(prisma);
    await expect(svc.deleteUser('tenant-A', 'u1')).resolves.toBeUndefined();
  });

  it('throws 404 when the user does not exist', async () => {
    const svc = new ScimService(buildPrismaMock([]));
    await expect(svc.deleteUser('tenant-A', 'ghost')).rejects.toThrow(NotFoundException);
  });
});
