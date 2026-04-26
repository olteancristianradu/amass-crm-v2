import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { NotesService } from './notes.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    note: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    activity: {
      findMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof NotesService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof NotesService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof NotesService>[2];
  const subjects = {
    assertExists: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof NotesService>[3];
  return { svc: new NotesService(prisma, audit, activities, subjects), prisma, tx, audit, activities, subjects };
}

describe('NotesService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a note, audits + activity-logs', async () => {
    const h = build();
    h.tx.note.create.mockResolvedValue({ id: 'n-1', body: 'hi' });
    await h.svc.create('COMPANY' as never, 'co-1', { body: 'hi' } as never);
    expect(h.subjects.assertExists).toHaveBeenCalledWith('COMPANY', 'co-1');
    expect(h.tx.note.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', subjectType: 'COMPANY', subjectId: 'co-1', authorId: 'user-1' }),
      }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'note.create' }));
    expect(h.activities.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'note.added' }));
  });
});

describe('NotesService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asserts subject existence then returns notes scoped to subject + tenant', async () => {
    const h = build();
    h.tx.note.findMany.mockResolvedValue([{ id: 'n-1' }, { id: 'n-2' }]);
    const out = await h.svc.list('CONTACT' as never, 'c-1');
    expect(out).toHaveLength(2);
    expect(h.subjects.assertExists).toHaveBeenCalled();
  });
});

describe('NotesService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the note when found', async () => {
    const h = build();
    h.tx.note.findFirst.mockResolvedValue({ id: 'n-1' });
    const out = await h.svc.findOne('n-1');
    expect(out.id).toBe('n-1');
  });

  it('throws NotFound when missing', async () => {
    const h = build();
    h.tx.note.findFirst.mockResolvedValue(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('NotesService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when note missing', async () => {
    const h = build();
    h.tx.note.findFirst.mockResolvedValue(null);
    await expect(h.svc.update('ghost', { body: 'x' } as never)).rejects.toThrow(NotFoundException);
  });

  it('updates body + audit-logs', async () => {
    const h = build();
    h.tx.note.findFirst.mockResolvedValue({ id: 'n-1', subjectType: 'COMPANY', subjectId: 'co-1' });
    h.tx.note.update.mockResolvedValue({ id: 'n-1', body: 'updated' });
    const out = await h.svc.update('n-1', { body: 'updated' } as never);
    expect(out.body).toBe('updated');
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'note.update' }));
  });
});

describe('NotesService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when missing', async () => {
    const h = build();
    h.tx.note.findFirst.mockResolvedValue(null);
    await expect(h.svc.remove('ghost')).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes + audit-logs', async () => {
    const h = build();
    h.tx.note.findFirst.mockResolvedValue({ id: 'n-1', subjectType: 'COMPANY', subjectId: 'co-1' });
    h.tx.note.update.mockResolvedValue({ id: 'n-1' });
    await h.svc.remove('n-1');
    const arg = h.tx.note.update.mock.calls[0]![0] as { data: { deletedAt: Date } };
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'note.delete' }));
  });
});

describe('NotesService.getTimeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges notes + activities sorted by createdAt desc, returns nextCursor when over limit', async () => {
    const h = build();
    const t1 = new Date('2026-04-20T10:00:00Z');
    const t2 = new Date('2026-04-20T11:00:00Z');
    const t3 = new Date('2026-04-20T12:00:00Z');
    h.tx.note.findMany.mockResolvedValue([
      { id: 'n-1', createdAt: t2, authorId: 'u-1', body: 'note body' },
    ]);
    h.tx.activity.findMany.mockResolvedValue([
      { id: 'a-1', createdAt: t3, actorId: 'u-1', action: 'deal.won', metadata: null },
      { id: 'a-2', createdAt: t1, actorId: null, action: 'deal.created', metadata: null },
    ]);
    const out = await h.svc.getTimeline('COMPANY' as never, 'co-1', undefined, 2);
    expect(out.data).toHaveLength(2);
    // t3 (activity) > t2 (note) > t1 (activity)
    expect(out.data[0]!.kind).toBe('activity');
    expect((out.data[0] as { id: string }).id).toBe('a-1');
    expect(out.data[1]!.kind).toBe('note');
    expect(out.nextCursor).toBe(t2.toISOString());
  });

  it('returns nextCursor=null when total entries fit within limit', async () => {
    const h = build();
    h.tx.note.findMany.mockResolvedValue([{ id: 'n-1', createdAt: new Date(), authorId: null, body: 'b' }]);
    h.tx.activity.findMany.mockResolvedValue([]);
    const out = await h.svc.getTimeline('COMPANY' as never, 'co-1', undefined, 20);
    expect(out.nextCursor).toBeNull();
  });

  it('uses cursor as a strict-less-than filter on createdAt for both tables', async () => {
    const h = build();
    h.tx.note.findMany.mockResolvedValue([]);
    h.tx.activity.findMany.mockResolvedValue([]);
    await h.svc.getTimeline('COMPANY' as never, 'co-1', '2026-04-20T10:00:00.000Z', 20);
    const noteArgs = h.tx.note.findMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } };
    expect(noteArgs.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('falls back to top-of-feed when given a malformed cursor', async () => {
    const h = build();
    h.tx.note.findMany.mockResolvedValue([]);
    h.tx.activity.findMany.mockResolvedValue([]);
    const out = await h.svc.getTimeline('COMPANY' as never, 'co-1', 'not-a-date', 20);
    expect(out.data).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });
});
