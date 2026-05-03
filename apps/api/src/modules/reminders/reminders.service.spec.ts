import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RemindersService } from './reminders.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    reminder: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof RemindersService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof RemindersService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof RemindersService>[2];
  const subjects = { assertExists: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof RemindersService>[3];
  const queue = { add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof RemindersService>[4];
  const svc = new RemindersService(prisma, audit, activities, subjects, queue);
  return { svc, prisma, tx, audit, activities, subjects, queue };
}

const NOW = new Date('2026-05-10T10:00:00Z');

describe('RemindersService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asserts subject exists before creating', async () => {
    const h = build();
    h.tx.reminder.create.mockResolvedValueOnce({
      id: 'r-1',
      title: 'Call back',
      body: null,
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      remindAt: NOW,
      status: 'PENDING',
    });
    await h.svc.create('CONTACT', 'c-1', { title: 'Call back', remindAt: NOW });
    expect(h.subjects.assertExists).toHaveBeenCalledWith('CONTACT', 'c-1');
  });

  it('persists tenantId + subjectType + subjectId in the row', async () => {
    const h = build();
    h.tx.reminder.create.mockResolvedValueOnce({
      id: 'r-1',
      title: 'Call back',
      body: null,
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      remindAt: NOW,
      status: 'PENDING',
    });
    await h.svc.create('CONTACT', 'c-1', { title: 'Call back', remindAt: NOW });
    expect(h.tx.reminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          subjectType: 'CONTACT',
          subjectId: 'c-1',
          title: 'Call back',
        }),
      }),
    );
  });

  it('enqueues a delayed BullMQ job after creating', async () => {
    const h = build();
    h.tx.reminder.create.mockResolvedValueOnce({
      id: 'r-2',
      title: 'Follow-up',
      body: null,
      subjectType: 'COMPANY',
      subjectId: 'co-1',
      remindAt: NOW,
      status: 'PENDING',
    });
    await h.svc.create('COMPANY', 'co-1', { title: 'Follow-up', remindAt: NOW });
    expect(h.queue.add).toHaveBeenCalledWith(
      'fire',
      expect.objectContaining({ reminderId: 'r-2', tenantId: 'tenant-1' }),
      expect.objectContaining({ jobId: 'r-2' }),
    );
  });

  it('emits audit + activity after creating', async () => {
    const h = build();
    h.tx.reminder.create.mockResolvedValueOnce({
      id: 'r-3',
      title: 'Check-in',
      body: null,
      subjectType: 'CONTACT',
      subjectId: 'c-2',
      remindAt: NOW,
      status: 'PENDING',
    });
    await h.svc.create('CONTACT', 'c-2', { title: 'Check-in', remindAt: NOW });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reminder.create', subjectId: 'c-2' }),
    );
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reminder.created', subjectType: 'CONTACT', subjectId: 'c-2' }),
    );
  });
});

describe('RemindersService.listForSubject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asserts subject exists and queries by subjectType + subjectId', async () => {
    const h = build();
    h.tx.reminder.findMany.mockResolvedValueOnce([]);
    await h.svc.listForSubject('CONTACT', 'c-1');
    expect(h.subjects.assertExists).toHaveBeenCalledWith('CONTACT', 'c-1');
    const where = h.tx.reminder.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      deletedAt: null,
    });
  });

  it('returns the list of reminders', async () => {
    const h = build();
    const rows = [
      { id: 'r-1', status: 'PENDING', remindAt: NOW },
      { id: 'r-2', status: 'FIRED', remindAt: NOW },
    ];
    h.tx.reminder.findMany.mockResolvedValueOnce(rows);
    const result = await h.svc.listForSubject('CONTACT', 'c-1');
    expect(result).toHaveLength(2);
  });
});

describe('RemindersService.listMine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters by actorId (current user) and default status=PENDING', async () => {
    const h = build();
    h.tx.reminder.findMany.mockResolvedValueOnce([]);
    await h.svc.listMine(undefined, 10);
    const where = h.tx.reminder.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ actorId: 'user-1', status: 'PENDING', deletedAt: null });
  });

  it('returns nextCursor when result exceeds limit', async () => {
    const h = build();
    const rows = [
      { id: 'r-1', remindAt: new Date('2026-05-11T10:00:00Z') },
      { id: 'r-2', remindAt: new Date('2026-05-12T10:00:00Z') },
      { id: 'r-3', remindAt: new Date('2026-05-13T10:00:00Z') },
    ];
    h.tx.reminder.findMany.mockResolvedValueOnce(rows);
    const page = await h.svc.listMine(undefined, 2);
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).toBe(new Date('2026-05-12T10:00:00Z').toISOString());
  });

  it('returns nextCursor=null when fewer rows than limit', async () => {
    const h = build();
    h.tx.reminder.findMany.mockResolvedValueOnce([{ id: 'r-1', remindAt: NOW }]);
    const page = await h.svc.listMine(undefined, 10);
    expect(page.nextCursor).toBeNull();
  });

  it('applies cursor as gt filter when a valid cursor is provided', async () => {
    const h = build();
    h.tx.reminder.findMany.mockResolvedValueOnce([]);
    const cursorDate = new Date('2026-05-10T09:00:00Z');
    await h.svc.listMine(cursorDate.toISOString(), 10);
    const where = h.tx.reminder.findMany.mock.calls[0][0].where;
    expect(where.remindAt).toEqual({ gt: cursorDate });
  });
});

describe('RemindersService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns reminder when found', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce({ id: 'r-1', title: 'Test' });
    const result = await h.svc.findOne('r-1');
    expect(result).toMatchObject({ id: 'r-1' });
  });

  it('throws NotFoundException with code REMINDER_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMINDER_NOT_FOUND' }),
    });
  });
});

describe('RemindersService.dismiss', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op and returns existing row when reminder is already non-PENDING', async () => {
    const h = build();
    const existing = { id: 'r-1', status: 'FIRED', subjectType: 'CONTACT', subjectId: 'c-1', title: 'X' };
    h.tx.reminder.findFirst.mockResolvedValueOnce(existing);
    const result = await h.svc.dismiss('r-1');
    expect(result).toBe(existing);
    expect(h.tx.reminder.update).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('sets status=DISMISSED, removes BullMQ job, and emits audit + activity for PENDING', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'PENDING',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      title: 'Ring',
    });
    h.tx.reminder.update.mockResolvedValueOnce({ id: 'r-1', status: 'DISMISSED' });
    await h.svc.dismiss('r-1');
    expect(h.queue.remove).toHaveBeenCalledWith('r-1');
    expect(h.tx.reminder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'DISMISSED' } }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reminder.dismiss' }),
    );
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reminder.dismissed' }),
    );
  });
});

describe('RemindersService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-deletes by setting deletedAt + status=CANCELLED and removes the BullMQ job', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'PENDING',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      title: 'X',
    });
    h.tx.reminder.update.mockResolvedValueOnce({ id: 'r-1' });
    await h.svc.remove('r-1');
    expect(h.queue.remove).toHaveBeenCalledWith('r-1');
    const data = h.tx.reminder.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.status).toBe('CANCELLED');
  });

  it('emits a reminder.delete audit log', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'PENDING',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      title: 'X',
    });
    h.tx.reminder.update.mockResolvedValueOnce({ id: 'r-1' });
    await h.svc.remove('r-1');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reminder.delete', subjectId: 'c-1' }),
    );
  });

  it('throws NotFoundException when reminder not found', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RemindersService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws REMINDER_NOT_EDITABLE when reminder is not PENDING', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'DISMISSED',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    await expect(h.svc.update('r-1', { title: 'New title' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMINDER_NOT_EDITABLE' }),
    });
  });

  it('updates title/body for a PENDING reminder and emits audit', async () => {
    const h = build();
    h.tx.reminder.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'PENDING',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    h.tx.reminder.update.mockResolvedValueOnce({
      id: 'r-1',
      title: 'Updated',
      remindAt: NOW,
    });
    await h.svc.update('r-1', { title: 'Updated' });
    const data = h.tx.reminder.update.mock.calls[0][0].data;
    expect(data.title).toBe('Updated');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reminder.update' }),
    );
  });

  it('re-enqueues BullMQ job when remindAt changes', async () => {
    const h = build();
    const newDate = new Date('2026-06-01T12:00:00Z');
    h.tx.reminder.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'PENDING',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    h.tx.reminder.update.mockResolvedValueOnce({ id: 'r-1', remindAt: newDate });
    await h.svc.update('r-1', { remindAt: newDate });
    expect(h.queue.remove).toHaveBeenCalledWith('r-1');
    expect(h.queue.add).toHaveBeenCalledWith(
      'fire',
      expect.objectContaining({ reminderId: 'r-1' }),
      expect.objectContaining({ jobId: 'r-1' }),
    );
  });
});
