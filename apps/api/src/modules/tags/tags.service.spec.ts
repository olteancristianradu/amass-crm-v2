import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    tag: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    entityTag: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof TagsService>[0];
  const svc = new TagsService(prisma);
  return { svc, prisma, tx };
}

describe('TagsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a tag with tenantId + name + color', async () => {
    const h = build();
    h.tx.tag.create.mockResolvedValueOnce({ id: 't-1', name: 'VIP', color: '#ff0000', tenantId: 'tenant-1' });
    const result = await h.svc.create({ name: 'VIP', color: '#ff0000' });
    expect(h.tx.tag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', name: 'VIP', color: '#ff0000' }),
      }),
    );
    expect(result).toMatchObject({ id: 't-1', name: 'VIP' });
  });

  it('defaults color to null when not provided', async () => {
    const h = build();
    h.tx.tag.create.mockResolvedValueOnce({ id: 't-2', name: 'Lead', color: null, tenantId: 'tenant-1' });
    await h.svc.create({ name: 'Lead' });
    expect(h.tx.tag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ color: null }),
      }),
    );
  });

  it('throws ConflictException with code TAG_EXISTS when create fails (duplicate)', async () => {
    const h = build();
    h.tx.tag.create.mockRejectedValueOnce(new Error('Unique constraint'));
    await expect(h.svc.create({ name: 'VIP' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAG_EXISTS' }),
    });
  });
});

describe('TagsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all tenant tags with _count when no entityId filter', async () => {
    const h = build();
    const tags = [
      { id: 't-1', name: 'VIP', _count: { entityTags: 3 } },
      { id: 't-2', name: 'Lead', _count: { entityTags: 1 } },
    ];
    h.tx.tag.findMany.mockResolvedValueOnce(tags);
    const result = await h.svc.list({});
    expect(h.tx.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1' }),
        orderBy: { name: 'asc' },
      }),
    );
    expect(result).toHaveLength(2);
  });

  it('filters by entityType using entityTags.some when entityType provided without entityId', async () => {
    const h = build();
    h.tx.tag.findMany.mockResolvedValueOnce([]);
    await h.svc.list({ entityType: 'CONTACT' });
    const where = h.tx.tag.findMany.mock.calls[0][0].where;
    expect(where.entityTags).toEqual({ some: { entityType: 'CONTACT' } });
  });

  it('returns tags via entityTag join when both entityId + entityType provided', async () => {
    const h = build();
    const entityTags = [
      { tag: { id: 't-1', name: 'VIP', _count: { entityTags: 2 } } },
    ];
    h.tx.entityTag.findMany.mockResolvedValueOnce(entityTags);
    const result = await h.svc.list({ entityId: 'c-1', entityType: 'CONTACT' });
    expect(h.tx.entityTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityId: 'c-1', entityType: 'CONTACT' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 't-1' });
  });
});

describe('TagsService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates name and color for an existing tag', async () => {
    const h = build();
    // assertTag call
    h.tx.tag.findFirst.mockResolvedValueOnce({ id: 't-1', name: 'VIP', tenantId: 'tenant-1' });
    h.tx.tag.update.mockResolvedValueOnce({ id: 't-1', name: 'VVIP', color: '#blue' });
    const result = await h.svc.update('t-1', { name: 'VVIP', color: '#blue' });
    expect(h.tx.tag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1' },
        data: expect.objectContaining({ name: 'VVIP', color: '#blue' }),
      }),
    );
    expect(result).toMatchObject({ id: 't-1' });
  });

  it('throws NotFoundException with code TAG_NOT_FOUND when tag is missing', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.update('ghost', { name: 'X' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAG_NOT_FOUND' }),
    });
    expect(h.tx.tag.update).not.toHaveBeenCalled();
  });

  it('only applies provided fields (partial update)', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce({ id: 't-1', name: 'VIP', tenantId: 'tenant-1' });
    h.tx.tag.update.mockResolvedValueOnce({ id: 't-1', name: 'VIP', color: '#new' });
    await h.svc.update('t-1', { color: '#new' });
    const data = h.tx.tag.update.mock.calls[0][0].data;
    expect(data.name).toBeUndefined();
    expect(data.color).toBe('#new');
  });
});

describe('TagsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes tag after asserting it exists', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce({ id: 't-1', name: 'VIP', tenantId: 'tenant-1' });
    h.tx.tag.delete.mockResolvedValueOnce({ id: 't-1' });
    await h.svc.remove('t-1');
    expect(h.tx.tag.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
  });

  it('throws NotFoundException when tag not found', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.tag.delete).not.toHaveBeenCalled();
  });
});

describe('TagsService.assign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an EntityTag after asserting tag exists', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce({ id: 't-1', name: 'VIP', tenantId: 'tenant-1' });
    h.tx.entityTag.create.mockResolvedValueOnce({ id: 'et-1', tagId: 't-1', entityId: 'c-1', entityType: 'CONTACT' });
    const result = await h.svc.assign('t-1', { entityType: 'CONTACT', entityId: 'c-1' });
    expect(h.tx.entityTag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', tagId: 't-1', entityId: 'c-1', entityType: 'CONTACT' }),
      }),
    );
    expect(result).toMatchObject({ id: 'et-1' });
  });

  it('throws ConflictException TAG_ALREADY_ASSIGNED on duplicate assignment', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce({ id: 't-1', name: 'VIP', tenantId: 'tenant-1' });
    h.tx.entityTag.create.mockRejectedValueOnce(new Error('Unique constraint'));
    await expect(h.svc.assign('t-1', { entityType: 'CONTACT', entityId: 'c-1' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAG_ALREADY_ASSIGNED' }),
    });
  });

  it('throws NotFoundException when tag not found', async () => {
    const h = build();
    h.tx.tag.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.assign('ghost', { entityType: 'CONTACT', entityId: 'c-1' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TagsService.unassign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes EntityTag rows matching tenantId + tagId + entityId', async () => {
    const h = build();
    h.tx.entityTag.deleteMany.mockResolvedValueOnce({ count: 1 });
    await h.svc.unassign('t-1', 'c-1');
    expect(h.tx.entityTag.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', tagId: 't-1', entityId: 'c-1' },
    });
  });
});

describe('TagsService.getTagsForEntities', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty Map for an empty entityIds array without hitting DB', async () => {
    const h = build();
    const result = await h.svc.getTagsForEntities('CONTACT', []);
    expect(result.size).toBe(0);
    expect(h.prisma.runWithTenant).not.toHaveBeenCalled();
  });

  it('returns a Map indexed by entityId', async () => {
    const h = build();
    h.tx.entityTag.findMany.mockResolvedValueOnce([
      { entityId: 'c-1', tag: { id: 't-1', name: 'VIP' } },
      { entityId: 'c-1', tag: { id: 't-2', name: 'Lead' } },
      { entityId: 'c-2', tag: { id: 't-1', name: 'VIP' } },
    ]);
    const result = await h.svc.getTagsForEntities('CONTACT', ['c-1', 'c-2']);
    expect(result.get('c-1')).toHaveLength(2);
    expect(result.get('c-2')).toHaveLength(1);
  });
});
