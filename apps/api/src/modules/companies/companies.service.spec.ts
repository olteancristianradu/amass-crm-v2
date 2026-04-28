import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    company: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof CompaniesService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof CompaniesService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof CompaniesService>[2];
  const embedding = { updateCompany: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof CompaniesService>[3];
  const workflows = { trigger: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof CompaniesService>[4];
  const webhooks = { dispatch: vi.fn() } as unknown as ConstructorParameters<typeof CompaniesService>[5];
  const svc = new CompaniesService(prisma, audit, activities, embedding, workflows, webhooks);
  return { svc, prisma, tx, audit, activities, embedding, workflows, webhooks };
}

describe('CompaniesService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the company with tenantId + creator and triggers side-effects', async () => {
    const h = build();
    h.tx.company.create.mockResolvedValueOnce({ id: 'co-1', name: 'Acme', industry: 'IT', city: 'Cluj', notes: null });
    await h.svc.create({ name: 'Acme', industry: 'IT', city: 'Cluj' } as never);
    const createArgs = h.tx.company.create.mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe('tenant-1');
    expect(createArgs.data.createdById).toBe('user-1');
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.create' }));
    expect(h.activities.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.created' }));
    expect(h.embedding.updateCompany).toHaveBeenCalledWith('co-1', expect.stringContaining('Acme'));
    expect(h.workflows.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'COMPANY_CREATED', subjectId: 'co-1' }),
    );
  });

  it('builds the embedding text from non-null fields only', async () => {
    const h = build();
    h.tx.company.create.mockResolvedValueOnce({
      id: 'co-2',
      name: 'Beta',
      industry: null,
      city: 'București',
      notes: null,
    });
    await h.svc.create({ name: 'Beta', city: 'București' } as never);
    const text = vi.mocked(h.embedding.updateCompany).mock.calls[0][1];
    expect(text).toBe('Beta București');
  });
});

describe('CompaniesService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits the search clause when q is undefined', async () => {
    const h = build();
    h.tx.company.findMany.mockResolvedValueOnce([]);
    await h.svc.list(undefined, 25, undefined);
    const where = h.tx.company.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.deletedAt).toBeNull();
    expect('OR' in where).toBe(false);
  });

  it('applies a multi-field OR predicate when q is set', async () => {
    const h = build();
    h.tx.company.findMany.mockResolvedValueOnce([]);
    await h.svc.list(undefined, 25, 'Acme');
    const where = h.tx.company.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(3);
    expect(where.OR[0].name).toEqual({ contains: 'Acme', mode: 'insensitive' });
    expect(where.OR[1].vatNumber).toEqual({ contains: 'Acme', mode: 'insensitive' });
    expect(where.OR[2].email).toEqual({ contains: 'Acme', mode: 'insensitive' });
  });
});

describe('CompaniesService.findOne / subsidiaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws COMPANY_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });

  it('subsidiaries scopes by parentId + tenant + deletedAt:null', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce({ id: 'co-1' });
    h.tx.company.findMany.mockResolvedValueOnce([{ id: 'sub-1' }]);
    await h.svc.subsidiaries('co-1');
    const where = h.tx.company.findMany.mock.calls[0][0].where;
    expect(where.parentId).toBe('co-1');
    expect(where.tenantId).toBe('tenant-1');
    expect(where.deletedAt).toBeNull();
  });
});

describe('CompaniesService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs audit + activity with the patched field names', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce({ id: 'co-1' });
    h.tx.company.update.mockResolvedValueOnce({ id: 'co-1', name: 'Acme', industry: null, city: null, notes: null });
    await h.svc.update('co-1', { name: 'Acme' } as never);
    const auditCall = vi.mocked(h.audit.log).mock.calls[0][0];
    const activityCall = vi.mocked(h.activities.log).mock.calls[0][0];
    expect(auditCall.metadata?.fields).toEqual(['name']);
    expect(activityCall.metadata?.fields).toEqual(['name']);
  });

  it('refuses to update a company that does not exist', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.update('ghost', { name: 'X' } as never)).rejects.toThrow(NotFoundException);
    expect(h.tx.company.update).not.toHaveBeenCalled();
  });
});

describe('CompaniesService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-deletes and emits a delete audit + activity', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce({ id: 'co-1' });
    h.tx.company.update.mockResolvedValueOnce({ id: 'co-1' });
    await h.svc.remove('co-1');
    const data = h.tx.company.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.delete' }));
    expect(h.activities.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.deleted' }));
  });
});
