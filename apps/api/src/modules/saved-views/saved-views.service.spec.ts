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
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
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
        action: 'savedview.created',
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

  it('I-3: rejects with 409 SAVED_VIEW_LIMIT_REACHED when owner already has 50 views', async () => {
    const h = build();
    h.tx.savedView.count.mockResolvedValueOnce(50);
    await expect(
      h.svc.create({ resource: 'companies', name: 'overflow', filters: {} }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SAVED_VIEW_LIMIT_REACHED' }),
    });
    expect(h.tx.savedView.create).not.toHaveBeenCalled();
  });

  it('I-3: allows the 50th view (exactly at limit) when count is 49', async () => {
    const h = build();
    h.tx.savedView.count.mockResolvedValueOnce(49);
    h.tx.savedView.create.mockResolvedValueOnce({ id: 'v50', resource: 'companies', name: 'fiftieth' });
    await h.svc.create({ resource: 'companies', name: 'fiftieth', filters: {} });
    expect(h.tx.savedView.create).toHaveBeenCalled();
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

  it('HIGH-2: uses scoped updateMany with tenantId + ownerId in WHERE (no TOCTOU)', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', name: 'old', resource: 'deals' });
    h.tx.savedView.updateMany.mockResolvedValueOnce({ count: 1 });
    h.tx.savedView.findFirstOrThrow.mockResolvedValueOnce({ id: 'v1', name: 'New name', resource: 'deals' });
    await h.svc.update('v1', { name: 'New name' });
    expect(h.tx.savedView.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v1', tenantId: 'tenant-1', ownerId: 'user-1' },
        data: expect.objectContaining({ name: 'New name' }),
      }),
    );
    // The legacy `.update({ where: { id } })` path must NOT be used anymore.
    expect(h.tx.savedView.update).not.toHaveBeenCalled();
  });

  it('HIGH-2: throws NotFound when updateMany count is 0 (row vanished mid-tx)', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', name: 'old', resource: 'deals' });
    h.tx.savedView.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(h.svc.update('v1', { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only patches keys present in the dto', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', name: 'old', resource: 'deals' });
    h.tx.savedView.updateMany.mockResolvedValueOnce({ count: 1 });
    h.tx.savedView.findFirstOrThrow.mockResolvedValueOnce({ id: 'v1', name: 'New name', resource: 'deals' });

    await h.svc.update('v1', { name: 'New name' });
    const data = h.tx.savedView.updateMany.mock.calls[0][0].data;
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
    h.tx.savedView.updateMany.mockResolvedValueOnce({ count: 1 });
    h.tx.savedView.findFirstOrThrow.mockResolvedValueOnce({
      id: 'v1',
      name: 'New',
      resource: 'deals',
    });
    await h.svc.update('v1', { name: 'New' });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'savedview.updated',
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
    h.tx.savedView.updateMany.mockRejectedValueOnce(err);
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

  it('HIGH-2: hard-deletes via scoped deleteMany and audits the action', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({
      id: 'v1',
      name: 'gone',
      resource: 'deals',
    });
    h.tx.savedView.deleteMany.mockResolvedValueOnce({ count: 1 });
    await h.svc.remove('v1');
    expect(h.tx.savedView.deleteMany).toHaveBeenCalledWith({
      where: { id: 'v1', tenantId: 'tenant-1', ownerId: 'user-1' },
    });
    expect(h.tx.savedView.delete).not.toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'savedview.deleted',
        subjectId: 'v1',
        metadata: expect.objectContaining({ resource: 'deals', name: 'gone' }),
      }),
    );
  });

  it('HIGH-2: throws NotFound when deleteMany count is 0 (row vanished mid-tx)', async () => {
    const h = build();
    h.tx.savedView.findFirst.mockResolvedValueOnce({ id: 'v1', name: 'gone', resource: 'deals' });
    h.tx.savedView.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(h.svc.remove('v1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SavedView schema — HIGH-3 (bidi) + MED-1 (.strict())', () => {
  // Construct the malicious payloads via escape sequences so the source
  // file itself stays clean of bidi codepoints (eslint-plugin-security
  // forbids them in source per security/detect-bidi-characters).
  const RTL_OVERRIDE = String.fromCharCode(0x202e); // Right-to-Left override
  const FIRST_STRONG_ISOLATE = String.fromCharCode(0x2068); // First Strong Isolate

  it('HIGH-3: rejects names containing bidi override codepoints (e.g. U+202E)', async () => {
    const { CreateSavedViewSchema } = await import('@amass/shared');
    const result = CreateSavedViewSchema.safeParse({
      resource: 'companies',
      name: `Confirm${RTL_OVERRIDE}Delete`,
      filters: {},
    });
    expect(result.success).toBe(false);
  });

  it('HIGH-3: rejects names containing isolate codepoints (U+2066–U+2069)', async () => {
    const { CreateSavedViewSchema } = await import('@amass/shared');
    const result = CreateSavedViewSchema.safeParse({
      resource: 'companies',
      name: `Safe${FIRST_STRONG_ISOLATE}Trap`,
      filters: {},
    });
    expect(result.success).toBe(false);
  });

  it('MED-1: rejects unknown body keys (T-SV-S-01 mass-assignment defence)', async () => {
    const { CreateSavedViewSchema } = await import('@amass/shared');
    const result = CreateSavedViewSchema.safeParse({
      resource: 'companies',
      name: 'OK',
      filters: {},
      ownerId: 'attacker-stole-this',
    });
    expect(result.success).toBe(false);
  });

  it('MED-1: UpdateSavedViewSchema also rejects unknown keys', async () => {
    const { UpdateSavedViewSchema } = await import('@amass/shared');
    const result = UpdateSavedViewSchema.safeParse({
      name: 'OK',
      tenantId: 'other-tenant',
    });
    expect(result.success).toBe(false);
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
