import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';

vi.mock('bcrypt', () => ({
  hash: vi.fn(async (pw: string) => `hashed(${pw})`),
}));

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'actor-1' })),
}));

function build() {
  const tx = {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    session: { updateMany: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof UsersService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof UsersService>[1];
  return { svc: new UsersService(prisma, audit), prisma, tx, audit };
}

describe('UsersService.listForCurrentTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns users scoped to the current tenant with the safe-select projection', async () => {
    const h = build();
    h.tx.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@b.com' }]);
    const out = await h.svc.listForCurrentTenant();
    expect(out).toHaveLength(1);
    const arg = h.tx.user.findMany.mock.calls[0]![0] as { where: { tenantId: string }; select: Record<string, boolean> };
    expect(arg.where.tenantId).toBe('tenant-1');
    expect(arg.select.passwordHash).toBeUndefined(); // never leak hash
  });
});

describe('UsersService.getById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the user when found', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', email: 'a@b.com' });
    const out = await h.svc.getById('u-1');
    expect(out.id).toBe('u-1');
  });

  it('throws NotFound when missing', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue(null);
    await expect(h.svc.getById('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('UsersService.invite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws EMAIL_TAKEN when the email already exists in this tenant', async () => {
    const h = build();
    h.tx.user.findUnique.mockResolvedValue({ id: 'u-existing' });
    await expect(
      h.svc.invite({ email: 'a@b.com', password: 'pw1234567', fullName: 'A', role: UserRole.AGENT } as never, 'actor-1'),
    ).rejects.toThrow(ConflictException);
    expect(h.tx.user.create).not.toHaveBeenCalled();
  });

  it('creates the user (with lowercased email + bcrypt hash) and audit-logs', async () => {
    const h = build();
    h.tx.user.findUnique.mockResolvedValue(null);
    h.tx.user.create.mockResolvedValue({ id: 'u-new', email: 'a@b.com' });
    await h.svc.invite(
      { email: 'A@B.COM', password: 'pw1234567', fullName: 'A B', role: UserRole.AGENT } as never,
      'actor-1',
    );
    const createArg = h.tx.user.create.mock.calls[0]![0] as { data: { email: string; passwordHash: string; tenantId: string } };
    expect(createArg.data.email).toBe('a@b.com');
    expect(createArg.data.passwordHash).toBe('hashed(pw1234567)');
    expect(createArg.data.tenantId).toBe('tenant-1');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.invite', subjectId: 'u-new' }),
    );
  });
});

describe('UsersService.updateRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects assigning OWNER from a non-OWNER actor', async () => {
    const h = build();
    await expect(
      h.svc.updateRole('u-1', { role: UserRole.OWNER } as never, UserRole.ADMIN, 'actor-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when target user is missing', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue(null);
    await expect(
      h.svc.updateRole('ghost', { role: UserRole.AGENT } as never, UserRole.OWNER, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to demote the last OWNER of the tenant', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', role: UserRole.OWNER });
    h.tx.user.count.mockResolvedValue(1);
    await expect(
      h.svc.updateRole('u-1', { role: UserRole.ADMIN } as never, UserRole.OWNER, 'actor-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows demoting an OWNER when more than one OWNER exists', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', role: UserRole.OWNER });
    h.tx.user.count.mockResolvedValue(3);
    h.tx.user.update.mockResolvedValue({ id: 'u-1', role: UserRole.ADMIN });
    const out = await h.svc.updateRole('u-1', { role: UserRole.ADMIN } as never, UserRole.OWNER, 'actor-1');
    expect(out.role).toBe(UserRole.ADMIN);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.role_change', metadata: { from: UserRole.OWNER, to: UserRole.ADMIN } }),
    );
  });

  it('happy path role change between non-OWNER roles', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', role: UserRole.AGENT });
    h.tx.user.update.mockResolvedValue({ id: 'u-1', role: UserRole.MANAGER });
    await h.svc.updateRole('u-1', { role: UserRole.MANAGER } as never, UserRole.ADMIN, 'actor-1');
    // OWNER count is NOT consulted when target isn't OWNER
    expect(h.tx.user.count).not.toHaveBeenCalled();
  });
});

describe('UsersService.deactivate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when target is missing', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue(null);
    await expect(h.svc.deactivate('ghost', UserRole.OWNER, 'actor-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects self-deactivation', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'actor-1', role: UserRole.ADMIN });
    await expect(h.svc.deactivate('actor-1', UserRole.OWNER, 'actor-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects deactivating an OWNER from a non-OWNER actor', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', role: UserRole.OWNER });
    await expect(h.svc.deactivate('u-1', UserRole.ADMIN, 'actor-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects deactivating the last OWNER', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', role: UserRole.OWNER });
    h.tx.user.count.mockResolvedValue(1);
    await expect(h.svc.deactivate('u-1', UserRole.OWNER, 'actor-1')).rejects.toThrow(ForbiddenException);
  });

  it('happy path: revokes sessions, deactivates user, audits', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', role: UserRole.AGENT });
    h.tx.session.updateMany.mockResolvedValue({ count: 2 });
    h.tx.user.update.mockResolvedValue({ id: 'u-1', isActive: false });
    await h.svc.deactivate('u-1', UserRole.OWNER, 'actor-1');
    expect(h.tx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', revokedAt: null } }),
    );
    expect(h.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' }, data: { isActive: false } }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deactivate' }),
    );
  });
});

describe('UsersService.activate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when user missing', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue(null);
    await expect(h.svc.activate('ghost', 'actor-1')).rejects.toThrow(NotFoundException);
  });

  it('happy path: flips isActive=true + audits', async () => {
    const h = build();
    h.tx.user.findFirst.mockResolvedValue({ id: 'u-1', isActive: false });
    h.tx.user.update.mockResolvedValue({ id: 'u-1', isActive: true });
    await h.svc.activate('u-1', 'actor-1');
    expect(h.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.activate' }),
    );
  });
});
