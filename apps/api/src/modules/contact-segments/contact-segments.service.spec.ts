import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ContactSegmentsService } from './contact-segments.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    contactSegment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contact: { findMany: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ContactSegmentsService>[0];
  const svc = new ContactSegmentsService(prisma);
  return { svc, prisma, tx };
}

describe('ContactSegmentsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists tenantId + creator and stores filter JSON', async () => {
    const h = build();
    h.tx.contactSegment.create.mockResolvedValueOnce({ id: 's-1' });
    const filter = { op: 'AND', rules: [{ field: 'jobTitle', operator: 'contains', value: 'CEO' }] };
    await h.svc.create({ name: 'CEOs', filterJson: filter } as never);
    const args = h.tx.contactSegment.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.createdById).toBe('user-1');
    expect(args.data.name).toBe('CEOs');
    expect(args.data.filterJson).toEqual(filter);
    expect(args.data.description).toBeNull();
  });
});

describe('ContactSegmentsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws SEGMENT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.contactSegment.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('returns the segment when present', async () => {
    const h = build();
    h.tx.contactSegment.findFirst.mockResolvedValueOnce({ id: 's-1', name: 'X' });
    await expect(h.svc.findOne('s-1')).resolves.toMatchObject({ id: 's-1' });
  });
});

describe('ContactSegmentsService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only writes the fields present in the patch', async () => {
    const h = build();
    h.tx.contactSegment.findFirst.mockResolvedValueOnce({ id: 's-1' });
    h.tx.contactSegment.update.mockResolvedValueOnce({ id: 's-1' });
    await h.svc.update('s-1', { name: 'Renamed' } as never);
    const data = h.tx.contactSegment.update.mock.calls[0][0].data;
    expect(data.name).toBe('Renamed');
    expect('filterJson' in data).toBe(false);
    expect('description' in data).toBe(false);
  });

  it('writes description=null explicitly when patched', async () => {
    const h = build();
    h.tx.contactSegment.findFirst.mockResolvedValueOnce({ id: 's-1' });
    h.tx.contactSegment.update.mockResolvedValueOnce({ id: 's-1' });
    await h.svc.update('s-1', { description: null } as never);
    const data = h.tx.contactSegment.update.mock.calls[0][0].data;
    expect(data.description).toBeNull();
  });
});

describe('ContactSegmentsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hard-deletes the row after asserting existence', async () => {
    const h = build();
    h.tx.contactSegment.findFirst.mockResolvedValueOnce({ id: 's-1' });
    h.tx.contactSegment.delete.mockResolvedValueOnce({ id: 's-1' });
    await h.svc.remove('s-1');
    expect(h.tx.contactSegment.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });

  it('refuses to delete a non-existent segment', async () => {
    const h = build();
    h.tx.contactSegment.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.remove('ghost')).rejects.toThrow(NotFoundException);
    expect(h.tx.contactSegment.delete).not.toHaveBeenCalled();
  });
});

describe('ContactSegmentsService.preview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('translates an AND filter group into a Prisma where clause', async () => {
    const h = build();
    const filter = {
      op: 'AND',
      rules: [
        { field: 'jobTitle', operator: 'contains', value: 'manager' },
        { field: 'isDecider', operator: 'is_true', value: null },
      ],
    };
    h.tx.contactSegment.findFirst.mockResolvedValueOnce({ id: 's-1', filterJson: filter });
    h.tx.contact.findMany.mockResolvedValueOnce([{ id: 'c-1' }]);
    await h.svc.preview('s-1', 10);
    const where = h.tx.contact.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.deletedAt).toBeNull();
    expect(where.AND).toBeDefined();
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].jobTitle).toEqual({ contains: 'manager', mode: 'insensitive' });
    expect(where.AND[1].isDecider).toBe(true);
  });

  it('handles nested filter groups (one level of nesting)', async () => {
    const h = build();
    const filter = {
      op: 'OR',
      rules: [
        { field: 'firstName', operator: 'eq', value: 'Andrei' },
        {
          op: 'AND',
          rules: [
            { field: 'lastName', operator: 'eq', value: 'Popescu' },
            { field: 'email', operator: 'is_not_empty', value: null },
          ],
        },
      ],
    };
    h.tx.contactSegment.findFirst.mockResolvedValueOnce({ id: 's-1', filterJson: filter });
    h.tx.contact.findMany.mockResolvedValueOnce([]);
    await h.svc.preview('s-1', 10);
    const where = h.tx.contact.findMany.mock.calls[0][0].where;
    expect(where.OR[0].firstName).toEqual({ equals: 'Andrei' });
    expect(where.OR[1].AND).toHaveLength(2);
  });
});
