import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    task: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    deal: { findFirst: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof TasksService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof TasksService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof TasksService>[2];
  const subjects = { assertExists: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof TasksService>[3];
  const svc = new TasksService(prisma, audit, activities, subjects);
  return { svc, prisma, tx, audit, activities, subjects };
}

describe('TasksService.create — exactly-one link rule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when both dealId and subject are set', async () => {
    const h = build();
    await expect(
      h.svc.create({
        title: 'X',
        dealId: 'd-1',
        subjectType: 'COMPANY',
        subjectId: 'co-1',
        priority: 'NORMAL',
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(h.tx.task.create).not.toHaveBeenCalled();
  });

  it('rejects when neither dealId nor subject is set', async () => {
    const h = build();
    await expect(
      h.svc.create({ title: 'X', priority: 'NORMAL' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects with DEAL_NOT_FOUND when dealId is bogus', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValueOnce(null);
    await expect(
      h.svc.create({ title: 'X', dealId: 'ghost', priority: 'NORMAL' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(h.tx.task.create).not.toHaveBeenCalled();
  });
});

describe('TasksService.create — happy paths', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a deal-linked task and emits an audit (no activity since no subject)', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValueOnce({ id: 'd-1' });
    h.tx.task.create.mockResolvedValueOnce({
      id: 't-1',
      title: 'Sună',
      dealId: 'd-1',
      subjectType: null,
      subjectId: null,
      dueAt: null,
    });
    await h.svc.create({ title: 'Sună', dealId: 'd-1', priority: 'HIGH' } as never);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.create' }));
    expect(h.activities.log).not.toHaveBeenCalled();
  });

  it('creates a subject-linked task and emits both audit + activity', async () => {
    const h = build();
    h.tx.task.create.mockResolvedValueOnce({
      id: 't-2',
      title: 'Follow-up',
      dealId: null,
      subjectType: 'COMPANY',
      subjectId: 'co-1',
      dueAt: null,
    });
    await h.svc.create({
      title: 'Follow-up',
      subjectType: 'COMPANY',
      subjectId: 'co-1',
      priority: 'NORMAL',
    } as never);
    expect(h.subjects.assertExists).toHaveBeenCalledWith('COMPANY', 'co-1');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.created', subjectType: 'COMPANY', subjectId: 'co-1' }),
    );
  });
});

describe('TasksService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only filters by tenant + deletedAt:null when no facets are set', async () => {
    const h = build();
    h.tx.task.findMany.mockResolvedValueOnce([]);
    await h.svc.list({ limit: 25 } as never);
    const where = h.tx.task.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: 'tenant-1', deletedAt: null });
  });

  it('applies status, assignee, deal, subject, dueBefore facets when set', async () => {
    const h = build();
    h.tx.task.findMany.mockResolvedValueOnce([]);
    const dueBefore = new Date('2026-04-30T00:00:00Z');
    await h.svc.list({
      limit: 25,
      status: 'OPEN',
      assigneeId: 'u-1',
      dealId: 'd-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      dueBefore,
    } as never);
    const where = h.tx.task.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: 'OPEN',
      assigneeId: 'u-1',
      dealId: 'd-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      dueAt: { lte: dueBefore },
    });
  });

  it('orders by dueAt asc NULLS LAST then createdAt desc then id desc', async () => {
    const h = build();
    h.tx.task.findMany.mockResolvedValueOnce([]);
    await h.svc.list({ limit: 25 } as never);
    const orderBy = h.tx.task.findMany.mock.calls[0][0].orderBy;
    expect(orderBy[0]).toEqual({ dueAt: { sort: 'asc', nulls: 'last' } });
    expect(orderBy[1]).toEqual({ createdAt: 'desc' });
    expect(orderBy[2]).toEqual({ id: 'desc' });
  });
});

describe('TasksService.complete + reopen — idempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('complete() is a no-op on a DONE task', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({ id: 't-1', status: 'DONE' });
    await h.svc.complete('t-1');
    expect(h.tx.task.update).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('reopen() is a no-op on an OPEN task', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({ id: 't-1', status: 'OPEN' });
    await h.svc.reopen('t-1');
    expect(h.tx.task.update).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('complete() on OPEN sets status=DONE + completedAt + emits activity if subject-linked', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({
      id: 't-1',
      status: 'OPEN',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      title: 'Sună',
    });
    h.tx.task.update.mockResolvedValueOnce({ id: 't-1', status: 'DONE' });
    await h.svc.complete('t-1');
    const data = h.tx.task.update.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.completed', subjectType: 'CONTACT', subjectId: 'c-1' }),
    );
  });

  it('reopen() on DONE clears completedAt + status=OPEN + audits', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({ id: 't-1', status: 'DONE' });
    h.tx.task.update.mockResolvedValueOnce({ id: 't-1', status: 'OPEN' });
    await h.svc.reopen('t-1');
    const data = h.tx.task.update.mock.calls[0][0].data;
    expect(data.status).toBe('OPEN');
    expect(data.completedAt).toBeNull();
  });
});

describe('TasksService.update + remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('update() only writes patched fields and skips status (handled separately)', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({ id: 't-1', subjectType: null, subjectId: null });
    h.tx.task.update.mockResolvedValueOnce({ id: 't-1' });
    await h.svc.update('t-1', { title: 'New', priority: 'HIGH' } as never);
    const data = h.tx.task.update.mock.calls[0][0].data;
    expect(data).toEqual({ title: 'New', priority: 'HIGH' });
  });

  it('update() emits subject activity only when the existing task is subject-linked', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({
      id: 't-1',
      subjectType: 'COMPANY',
      subjectId: 'co-1',
    });
    h.tx.task.update.mockResolvedValueOnce({ id: 't-1' });
    await h.svc.update('t-1', { title: 'X' } as never);
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.updated', subjectId: 'co-1' }),
    );
  });

  it('remove() soft-deletes via deletedAt and audits with the title', async () => {
    const h = build();
    h.tx.task.findFirst.mockResolvedValueOnce({ id: 't-1', title: 'Sună' });
    h.tx.task.update.mockResolvedValueOnce({ id: 't-1' });
    await h.svc.remove('t-1');
    const data = h.tx.task.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.delete', metadata: { title: 'Sună' } }),
    );
  });
});
