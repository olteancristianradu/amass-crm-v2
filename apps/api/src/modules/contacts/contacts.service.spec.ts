import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    company: { findFirst: vi.fn() },
    contact: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ContactsService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ContactsService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ContactsService>[2];
  const embedding = { updateContact: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ContactsService>[3];
  const workflows = { trigger: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ContactsService>[4];
  const svc = new ContactsService(prisma, audit, activities, embedding, workflows);
  return { svc, prisma, tx, audit, activities, embedding, workflows };
}

describe('ContactsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a cross-tenant companyId before persisting', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce(null);
    await expect(
      h.svc.create({ firstName: 'A', lastName: 'B', companyId: 'cross-tenant-co' } as never),
    ).rejects.toThrow(BadRequestException);
    expect(h.tx.contact.create).not.toHaveBeenCalled();
  });

  it('skips the companyId existence check when companyId is omitted', async () => {
    const h = build();
    h.tx.contact.create.mockResolvedValueOnce({
      id: 'c-1',
      firstName: 'Ana',
      lastName: 'Pop',
      jobTitle: null,
      email: null,
      notes: null,
    });
    await h.svc.create({ firstName: 'Ana', lastName: 'Pop' } as never);
    expect(h.tx.company.findFirst).not.toHaveBeenCalled();
    expect(h.tx.contact.create).toHaveBeenCalled();
    expect(h.workflows.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'CONTACT_CREATED', subjectId: 'c-1' }),
    );
  });

  it('persists tenantId + creator and emits audit/activity', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce({ id: 'co-1' });
    h.tx.contact.create.mockResolvedValueOnce({
      id: 'c-2',
      firstName: 'Ion',
      lastName: 'Ion',
      jobTitle: 'CEO',
      email: 'ion@x.ro',
      notes: null,
    });
    await h.svc.create({ firstName: 'Ion', lastName: 'Ion', companyId: 'co-1' } as never);
    const data = h.tx.contact.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.createdById).toBe('user-1');
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.create' }));
    expect(h.activities.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.created' }));
    expect(h.embedding.updateContact).toHaveBeenCalledWith('c-2', expect.stringContaining('Ion'));
  });
});

describe('ContactsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a 4-field OR predicate when q is set', async () => {
    const h = build();
    h.tx.contact.findMany.mockResolvedValueOnce([]);
    await h.svc.list(undefined, 25, 'Ana');
    const where = h.tx.contact.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(4);
    expect(where.tenantId).toBe('tenant-1');
    expect(where.deletedAt).toBeNull();
  });
});

describe('ContactsService.update + remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to update a missing contact', async () => {
    const h = build();
    h.tx.contact.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.update('ghost', { jobTitle: 'X' } as never)).rejects.toThrow(NotFoundException);
    expect(h.tx.contact.update).not.toHaveBeenCalled();
  });

  it('soft-deletes via deletedAt + emits delete audit/activity', async () => {
    const h = build();
    h.tx.contact.findFirst.mockResolvedValueOnce({ id: 'c-1' });
    h.tx.contact.update.mockResolvedValueOnce({ id: 'c-1' });
    await h.svc.remove('c-1');
    const data = h.tx.contact.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.delete' }));
    expect(h.activities.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.deleted' }));
  });
});
