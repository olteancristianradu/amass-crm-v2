import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavedViewsService } from './saved-views.service';

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
  const svc = new SavedViewsService(prisma);
  return { svc, tx };
}

describe('SavedViewsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists tenantId + ownerId from context', async () => {
    const h = build();
    h.tx.savedView.create.mockResolvedValueOnce({ id: 'v1' });
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
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1' });
    h.tx.savedView.update.mockResolvedValueOnce({ id: 'v1' });

    await h.svc.update('v1', { name: 'New name' });
    const data = h.tx.savedView.update.mock.calls[0][0].data;
    expect(data.name).toBe('New name');
    expect(data.filters).toBeUndefined();
  });
});

describe('SavedViewsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when missing', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hard-deletes when found', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1' });
    h.tx.savedView.delete.mockResolvedValueOnce({});
    await h.svc.remove('v1');
    expect(h.tx.savedView.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });
});
