import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScimGroupsService } from './scim-groups.service';
import { SCIM_GROUP_SCHEMA_URN } from './scim.dto';

/**
 * Unit tests for ScimGroupsService. Mirrors the test scaffold in
 * scim.service.spec.ts: PrismaService is mocked with a `runWithTenant` that
 * itself filters/stamps the in-memory store by tenantId, reproducing the
 * production extension behavior so cross-tenant isolation can be asserted.
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
    preferredLocale: 'ro',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function buildPrismaMock(seedUsers: User[]) {
  let store: User[] = [...seedUsers];

  function makeTx(activeTenant: string) {
    const filterByTenant = (where: Record<string, unknown> | undefined) => {
      const w = where ?? {};
      return store.filter((u) => {
        if (u.tenantId !== activeTenant) return false;
        if (typeof w.id === 'string' && u.id !== w.id) return false;
        if (typeof w.role === 'string' && u.role !== (w.role as UserRole)) return false;
        if (
          w.id !== undefined &&
          typeof w.id === 'object' &&
          w.id !== null &&
          'in' in (w.id as Record<string, unknown>)
        ) {
          const ids = (w.id as { in: string[] }).in;
          if (!ids.includes(u.id)) return false;
        }
        return true;
      });
    };
    return {
      user: {
        findMany: vi.fn(
          async ({
            where,
          }: { where?: Record<string, unknown>; select?: unknown; orderBy?: unknown } = {}) => {
            return filterByTenant(where).sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
            );
          },
        ),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
          return filterByTenant(where)[0] ?? null;
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
  return prisma as unknown as ConstructorParameters<typeof ScimGroupsService>[0] & {
    runWithTenant: ReturnType<typeof vi.fn>;
    _store: () => User[];
    _reset: (s: User[]) => void;
  };
}

function buildAuditMock() {
  return {
    log: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof ScimGroupsService>[1] & {
    log: ReturnType<typeof vi.fn>;
  };
}

describe('ScimGroupsService.listGroups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all 5 synthetic groups with member counts derived from User.role', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', role: UserRole.OWNER, tenantId: 'tenant-A' }),
      makeUser({ id: 'u2', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
      makeUser({ id: 'u3', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
      makeUser({ id: 'u4', role: UserRole.VIEWER, tenantId: 'tenant-A' }),
    ]);
    const svc = new ScimGroupsService(prisma, buildAuditMock());
    const out = await svc.listGroups('tenant-A', 1, 50);
    expect(out.totalResults).toBe(5);
    expect(out.Resources).toHaveLength(5);
    const byId = Object.fromEntries(out.Resources.map((g) => [g.id, g]));
    expect(byId['role:OWNER']!.members).toHaveLength(1);
    expect(byId['role:ADMIN']!.members).toHaveLength(2);
    expect(byId['role:MANAGER']!.members).toHaveLength(0);
    expect(byId['role:AGENT']!.members).toHaveLength(0);
    expect(byId['role:VIEWER']!.members).toHaveLength(1);
    expect(byId['role:OWNER']!.schemas).toContain(SCIM_GROUP_SCHEMA_URN);
  });

  it('rejects filter expressions with 400 invalidFilter', async () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    await expect(
      svc.listGroups('tenant-A', 1, 50, 'displayName eq "ADMIN"'),
    ).rejects.toThrow(HttpException);
  });
});

describe('ScimGroupsService.getGroup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the group with hydrated members from User.role', async () => {
    const svc = new ScimGroupsService(
      buildPrismaMock([
        makeUser({ id: 'u1', role: UserRole.MANAGER, fullName: 'M One', tenantId: 'tenant-A' }),
        makeUser({ id: 'u2', role: UserRole.AGENT, tenantId: 'tenant-A' }),
      ]),
      buildAuditMock(),
    );
    const out = await svc.getGroup('tenant-A', 'role:MANAGER');
    expect(out.id).toBe('role:MANAGER');
    expect(out.displayName).toBe('MANAGER');
    expect(out.members.map((m) => m.value)).toEqual(['u1']);
    expect(out.members[0]!.display).toBe('M One');
    expect(out.meta.resourceType).toBe('Group');
  });

  it('throws 404 for unknown synthetic id', async () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    await expect(svc.getGroup('tenant-A', 'role:WIZARD')).rejects.toThrow(NotFoundException);
    await expect(svc.getGroup('tenant-A', 'random-id')).rejects.toThrow(NotFoundException);
  });
});

describe('ScimGroupsService.createGroup / deleteGroup', () => {
  it('returns 501 for POST', () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    try {
      svc.createGroup();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(501);
      const body = (err as HttpException).getResponse() as { scimType: string };
      expect(body.scimType).toBe('notImplemented');
    }
  });

  it('returns 501 for DELETE', () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    expect(() => svc.deleteGroup()).toThrow(HttpException);
    try {
      svc.deleteGroup();
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(501);
    }
  });
});

describe('ScimGroupsService.patchGroup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a member by setting User.role and writes audit log', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', role: UserRole.VIEWER, tenantId: 'tenant-A' }),
    ]);
    const audit = buildAuditMock();
    const svc = new ScimGroupsService(prisma, audit);
    const out = await svc.patchGroup('tenant-A', 'role:ADMIN', [
      { op: 'add', path: 'members', value: [{ value: 'u1' }] },
    ]);
    expect(out.id).toBe('role:ADMIN');
    expect(out.members.map((m) => m.value)).toEqual(['u1']);
    expect(prisma._store().find((u) => u.id === 'u1')!.role).toBe(UserRole.ADMIN);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'scim.group.member_added',
        subjectId: 'u1',
        tenantId: 'tenant-A',
      }),
    );
  });

  it('remove from non-VIEWER group downgrades User.role to VIEWER and audits', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
    ]);
    const audit = buildAuditMock();
    const svc = new ScimGroupsService(prisma, audit);
    await svc.patchGroup('tenant-A', 'role:ADMIN', [
      { op: 'remove', path: 'members', value: [{ value: 'u1' }] },
    ]);
    expect(prisma._store().find((u) => u.id === 'u1')!.role).toBe(UserRole.VIEWER);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scim.group.member_removed', subjectId: 'u1' }),
    );
  });

  it('remove from VIEWER group is a no-op (no role below VIEWER)', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', role: UserRole.VIEWER, tenantId: 'tenant-A' }),
    ]);
    const audit = buildAuditMock();
    const svc = new ScimGroupsService(prisma, audit);
    await svc.patchGroup('tenant-A', 'role:VIEWER', [
      { op: 'remove', path: 'members', value: [{ value: 'u1' }] },
    ]);
    expect(prisma._store().find((u) => u.id === 'u1')!.role).toBe(UserRole.VIEWER);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('add of a user already in the group is idempotent (no update, no audit)', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
    ]);
    const audit = buildAuditMock();
    const svc = new ScimGroupsService(prisma, audit);
    await svc.patchGroup('tenant-A', 'role:ADMIN', [
      { op: 'add', path: 'members', value: [{ value: 'u1' }] },
    ]);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects unknown member with 400 invalidValue', async () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    await expect(
      svc.patchGroup('tenant-A', 'role:ADMIN', [
        { op: 'add', path: 'members', value: [{ value: 'ghost' }] },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unsupported op with 400', async () => {
    const svc = new ScimGroupsService(
      buildPrismaMock([makeUser({ id: 'u1', tenantId: 'tenant-A' })]),
      buildAuditMock(),
    );
    await expect(
      svc.patchGroup('tenant-A', 'role:ADMIN', [
        { op: 'replace', path: 'displayName', value: 'NEW' },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 404 for unknown group id', async () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    await expect(
      svc.patchGroup('tenant-A', 'role:WIZARD', [
        { op: 'add', path: 'members', value: [{ value: 'u1' }] },
      ]),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ScimGroupsService.replaceGroupMembers (PUT)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('diffs current vs desired members and applies role updates atomically', async () => {
    const prisma = buildPrismaMock([
      // Current ADMINs: u1, u2.
      makeUser({ id: 'u1', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
      makeUser({ id: 'u2', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
      // Existing VIEWER candidate to promote.
      makeUser({ id: 'u3', role: UserRole.VIEWER, tenantId: 'tenant-A' }),
    ]);
    const audit = buildAuditMock();
    const svc = new ScimGroupsService(prisma, audit);
    // Desired: only u1 and u3. So u2 should be downgraded, u3 promoted.
    const out = await svc.replaceGroupMembers('tenant-A', 'role:ADMIN', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: 'ADMIN',
      members: [{ value: 'u1' }, { value: 'u3' }],
    });
    expect(out.members.map((m) => m.value).sort()).toEqual(['u1', 'u3']);
    const store = prisma._store();
    expect(store.find((u) => u.id === 'u1')!.role).toBe(UserRole.ADMIN);
    expect(store.find((u) => u.id === 'u2')!.role).toBe(UserRole.VIEWER); // downgraded
    expect(store.find((u) => u.id === 'u3')!.role).toBe(UserRole.ADMIN); // promoted
    // 2 audit entries: one add (u3), one remove (u2). u1 stayed.
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('rejects desired member that does not exist in the tenant before mutating', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'u1', role: UserRole.ADMIN, tenantId: 'tenant-A' }),
    ]);
    const svc = new ScimGroupsService(prisma, buildAuditMock());
    await expect(
      svc.replaceGroupMembers('tenant-A', 'role:ADMIN', {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        members: [{ value: 'u1' }, { value: 'ghost' }],
      }),
    ).rejects.toThrow(BadRequestException);
    // u1 must still be ADMIN — no partial mutation.
    expect(prisma._store().find((u) => u.id === 'u1')!.role).toBe(UserRole.ADMIN);
  });

  it('throws 404 for unknown group id', async () => {
    const svc = new ScimGroupsService(buildPrismaMock([]), buildAuditMock());
    await expect(
      svc.replaceGroupMembers('tenant-A', 'role:UNKNOWN', {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        members: [],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ScimGroupsService — multi-tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  // CRITICAL multi-tenant test: PATCH on tenant A must not touch tenant B
  // users. Both tenants happen to have a user with the SAME id to make the
  // failure mode (cross-tenant write) impossible to miss.
  it('PATCH on tenant A does NOT affect tenant B users (same user id in both)', async () => {
    const prisma = buildPrismaMock([
      makeUser({ id: 'shared-id', role: UserRole.VIEWER, tenantId: 'tenant-A' }),
      makeUser({ id: 'shared-id', role: UserRole.VIEWER, tenantId: 'tenant-B' }),
    ]);
    const audit = buildAuditMock();
    const svc = new ScimGroupsService(prisma, audit);

    // Promote shared-id to ADMIN inside tenant A.
    await svc.patchGroup('tenant-A', 'role:ADMIN', [
      { op: 'add', path: 'members', value: [{ value: 'shared-id' }] },
    ]);

    const store = prisma._store();
    const a = store.find((u) => u.id === 'shared-id' && u.tenantId === 'tenant-A')!;
    const b = store.find((u) => u.id === 'shared-id' && u.tenantId === 'tenant-B')!;
    expect(a.role).toBe(UserRole.ADMIN); // tenant A: updated
    expect(b.role).toBe(UserRole.VIEWER); // tenant B: unchanged

    // GET on tenant B must see VIEWER, not ADMIN.
    const bAdminGroup = await svc.getGroup('tenant-B', 'role:ADMIN');
    expect(bAdminGroup.members).toEqual([]);
    const bViewerGroup = await svc.getGroup('tenant-B', 'role:VIEWER');
    expect(bViewerGroup.members.map((m) => m.value)).toEqual(['shared-id']);

    // Confirm runWithTenant was invoked with each tenant id explicitly.
    const calls = (prisma.runWithTenant as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls.map((c) => c[0])).toEqual(['tenant-A', 'tenant-B', 'tenant-B']);
  });
});
