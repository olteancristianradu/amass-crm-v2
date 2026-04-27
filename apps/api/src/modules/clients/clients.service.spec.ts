import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    client: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ClientsService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ClientsService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ClientsService>[2];
  const embedding = { updateClient: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ClientsService>[3];
  const svc = new ClientsService(prisma, audit, activities, embedding);
  return { svc, prisma, tx, audit, activities, embedding };
}

describe('ClientsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists tenantId + creator and emits audit + activity + embedding', async () => {
    const h = build();
    h.tx.client.create.mockResolvedValueOnce({
      id: 'cl-1',
      firstName: 'Andrei',
      lastName: 'Popescu',
      email: 'a@x.ro',
      city: null,
      notes: null,
    });
    await h.svc.create({ firstName: 'Andrei', lastName: 'Popescu', email: 'a@x.ro' } as never);
    const data = h.tx.client.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.createdById).toBe('user-1');
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'client.create' }));
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.created', metadata: { name: 'Andrei Popescu' } }),
    );
    expect(h.embedding.updateClient).toHaveBeenCalledWith('cl-1', expect.stringContaining('Andrei'));
  });
});

describe('ClientsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches firstName/lastName/email/phone (case-insensitive) when q is set', async () => {
    const h = build();
    h.tx.client.findMany.mockResolvedValueOnce([]);
    await h.svc.list(undefined, 25, 'andrei');
    const where = h.tx.client.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(4);
    for (const cond of where.OR) {
      const field = Object.values(cond)[0] as { contains: string; mode: string };
      expect(field.contains).toBe('andrei');
      expect(field.mode).toBe('insensitive');
    }
  });

  it('skips the OR predicate when q is undefined', async () => {
    const h = build();
    h.tx.client.findMany.mockResolvedValueOnce([]);
    await h.svc.list(undefined, 25, undefined);
    const where = h.tx.client.findMany.mock.calls[0][0].where;
    expect('OR' in where).toBe(false);
  });
});

describe('ClientsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CLIENT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.client.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('ClientsService.update + remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the patched field names + re-embeds the merged record', async () => {
    const h = build();
    h.tx.client.findFirst.mockResolvedValueOnce({ id: 'cl-1' });
    h.tx.client.update.mockResolvedValueOnce({
      id: 'cl-1',
      firstName: 'Andrei',
      lastName: 'Popescu',
      email: null,
      city: null,
      notes: null,
    });
    await h.svc.update('cl-1', { firstName: 'Andrei', lastName: 'Popescu' } as never);
    const fields = vi.mocked(h.audit.log).mock.calls[0][0].metadata?.fields;
    expect(fields).toEqual(['firstName', 'lastName']);
    expect(h.embedding.updateClient).toHaveBeenCalledWith('cl-1', 'Andrei Popescu');
  });

  it('soft-deletes via deletedAt + emits delete audit/activity', async () => {
    const h = build();
    h.tx.client.findFirst.mockResolvedValueOnce({ id: 'cl-1' });
    h.tx.client.update.mockResolvedValueOnce({ id: 'cl-1' });
    await h.svc.remove('cl-1');
    const data = h.tx.client.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'client.delete' }));
    expect(h.activities.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'client.deleted' }));
  });
});
