import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavedViewsService } from './saved-views.service';
import type { AuditService } from '../audit/audit.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

type Mock = ReturnType<typeof vi.fn>;

function build() {
  const tx = {
    savedView: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const runWithTenant: Mock = vi.fn(async (_t: string, cbOrMode: unknown, maybeCb?: unknown) => {
    const cb = typeof cbOrMode === 'function' ? cbOrMode : maybeCb;
    return (cb as (t: typeof tx) => Promise<unknown>)(tx);
  });
  const prisma = { runWithTenant } as unknown as import('../../infra/prisma/prisma.service').PrismaService;
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const svc = new SavedViewsService(prisma, audit);
  return { svc, tx, audit: audit as unknown as { log: Mock } };
}

describe('SavedViewsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists tenantId + ownerId from context (T-SV-I-02 enforced server-side)', async () => {
    const h = build();
    h.tx.savedView.create.mockResolvedValueOnce({
      id: 'v1',
      resource: 'companies',
      name: 'Acme deals',
    });
    await h.svc.create({
      resource: 'companies',
      name: 'Acme deals',
      filters: { q: 'acme' },
    });
    const data = h.tx.savedView.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.ownerId).toBe('user-1');
    expect(data.resource).toBe('companies');
    expect(data.name).toBe('Acme deals');
    expect(data.filters).toEqual({ q: 'acme' });
  });

  it('translates Prisma P2002 to a friendly 409', async () => {
    const h = build();
    const err = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    h.tx.savedView.create.mockRejectedValueOnce(err);
    await expect(
      h.svc.create({ resource: 'companies', name: 'dup', filters: {} }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('emits an audit log on successful create (T-SV-R-01)', async () => {
    const h = build();
    h.tx.savedView.create.mockResolvedValueOnce({
      id: 'v1',
      resource: 'companies',
      name: 'Acme deals',
    });
    await h.svc.create({ resource: 'companies', name: 'Acme deals', filters: {} });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'saved_view.create',
        subjectType: 'saved_view',
        subjectId: 'v1',
      }),
    );
  });

  it('does NOT audit when the DB write fails (rollback semantics)', async () => {
    const h = build();
    const err = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    h.tx.savedView.create.mockRejectedValueOnce(err);
    await expect(
      h.svc.create({ resource: 'companies', name: 'dup', filters: {} }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.audit.log).not.toHaveBeenCalled();
  });
});

describe('SavedViewsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes by tenant + owner + resource and orders most-recently-updated first', async () => {
    const h = build();
    h.tx.savedView.findMany.mockResolvedValueOnce([{ id: 'v1' }, { id: 'v2' }]);
    const out = await h.svc.list('contacts');
    expect(out).toHaveLength(2);
    expect(h.tx.savedView.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', ownerId: 'user-1', resource: 'contacts' },
      orderBy: { updatedAt: 'desc' },
    });
  });
});

describe('SavedViewsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when missing or owned by another user', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the row when ownership matches', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', ownerId: 'user-1' });
    const out = await h.svc.findOne('v1');
    expect(out.id).toBe('v1');
    expect(h.tx.savedView.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', tenantId: 'tenant-1', ownerId: 'user-1' },
    });
  });
});

describe('SavedViewsService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when target is missing (NotFound)', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.update('ghost', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only patches keys present in the dto', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', name: 'old', resource: 'deals' });
    h.tx.savedView.update.mockResolvedValueOnce({ id: 'v1', name: 'New name', resource: 'deals' });

    await h.svc.update('v1', { name: 'New name' });
    const data = h.tx.savedView.update.mock.calls[0][0].data;
    expect(data.name).toBe('New name');
    expect(data.filters).toBeUndefined();
  });

  it('emits audit on update with before/after metadata', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({
      id: 'v1',
      name: 'old',
      resource: 'deals',
    });
    h.tx.savedView.update.mockResolvedValueOnce({
      id: 'v1',
      name: 'New',
      resource: 'deals',
    });
    await h.svc.update('v1', { name: 'New' });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'saved_view.update',
        subjectId: 'v1',
        metadata: expect.objectContaining({
          resource: 'deals',
          changed: expect.objectContaining({
            name: { from: 'old', to: 'New' },
          }),
        }),
      }),
    );
  });

  it('translates Prisma P2002 to 409 on rename collision', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', name: 'old', resource: 'deals' });
    const err = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    h.tx.savedView.update.mockRejectedValueOnce(err);
    await expect(h.svc.update('v1', { name: 'taken' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SavedViewsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when missing', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hard-deletes when found and audits the action', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({
      id: 'v1',
      name: 'gone',
      resource: 'deals',
    });
    h.tx.savedView.delete.mockResolvedValueOnce({});
    await h.svc.remove('v1');
    expect(h.tx.savedView.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'saved_view.delete',
        subjectId: 'v1',
        metadata: expect.objectContaining({ resource: 'deals', name: 'gone' }),
      }),
    );
  });
});

describe('SavedViewsService.getSystemDefaults', () => {
  it('returns 3 deals defaults including all-mine / won-this-month / lost-last-30d', () => {
    const h = build();
    const out = h.svc.getSystemDefaults('deals');
    expect(out).toHaveLength(3);
    const ids = out.map((v) => v.id).sort();
    expect(ids).toEqual([
      'system:deals:all-mine',
      'system:deals:lost-last-30d',
      'system:deals:won-this-month',
    ]);
    // i18n keys, not raw labels — FE handles locale.
    expect(out.every((v) => v.nameKey.startsWith('savedViews.defaults.deals.'))).toBe(true);
    // All ids must use the `system:` prefix so they NEVER collide with a cuid.
    expect(out.every((v) => v.id.startsWith('system:'))).toBe(true);
  });

  it('returns [] for resources without curated defaults yet', () => {
    const h = build();
    expect(h.svc.getSystemDefaults('contacts')).toEqual([]);
    expect(h.svc.getSystemDefaults('invoices')).toEqual([]);
  });
});
