import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { CustomFieldsService } from './custom-fields.service';

function build() {
  const tx = {
    customFieldDef: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    customFieldValue: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof CustomFieldsService>[0];
  const svc = new CustomFieldsService(prisma);
  return { svc, prisma, tx };
}

describe('CustomFieldsService.createDef', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects duplicate name within the same entityType', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({ id: 'cf-existing' });
    await expect(
      h.svc.createDef({
        entityType: 'COMPANY',
        fieldType: 'TEXT',
        name: 'industry',
        label: 'Industry',
        isRequired: false,
        order: 0,
      } as never),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects SELECT with no options', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce(null);
    await expect(
      h.svc.createDef({
        entityType: 'COMPANY',
        fieldType: 'SELECT',
        name: 'tier',
        label: 'Tier',
        isRequired: false,
        order: 0,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('persists when name is unique and TEXT', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce(null);
    h.tx.customFieldDef.create.mockResolvedValueOnce({ id: 'cf-1' });
    await h.svc.createDef({
      entityType: 'COMPANY',
      fieldType: 'TEXT',
      name: 'industry',
      label: 'Industry',
      isRequired: false,
      order: 0,
    } as never);
    const data = h.tx.customFieldDef.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.name).toBe('industry');
  });
});

describe('CustomFieldsService.listDefs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies entityType + isActive facets when set', async () => {
    const h = build();
    h.tx.customFieldDef.findMany.mockResolvedValueOnce([]);
    await h.svc.listDefs({ entityType: 'CONTACT', isActive: true } as never);
    const where = h.tx.customFieldDef.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 'tenant-1', deletedAt: null, entityType: 'CONTACT', isActive: true });
  });

  it('orders by entityType then order then label', async () => {
    const h = build();
    h.tx.customFieldDef.findMany.mockResolvedValueOnce([]);
    await h.svc.listDefs({} as never);
    expect(h.tx.customFieldDef.findMany.mock.calls[0][0].orderBy).toEqual([
      { entityType: 'asc' },
      { order: 'asc' },
      { label: 'asc' },
    ]);
  });
});

describe('CustomFieldsService.removeDef', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when missing', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.removeDef('ghost')).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes via deletedAt + flips isActive=false', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({ id: 'cf-1' });
    h.tx.customFieldDef.update.mockResolvedValueOnce({ id: 'cf-1' });
    await h.svc.removeDef('cf-1');
    const data = h.tx.customFieldDef.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.isActive).toBe(false);
  });
});

describe('CustomFieldsService.bulkSetValues — value validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-numeric value for NUMBER field', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'NUMBER',
      options: null,
    });
    await expect(
      h.svc.bulkSetValues('co-1', { values: [{ fieldDefId: 'cf-1', value: 'abc' }] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a parseable date for DATE field', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'DATE',
      options: null,
    });
    h.tx.customFieldValue.upsert.mockResolvedValueOnce({});
    await expect(
      h.svc.bulkSetValues('co-1', { values: [{ fieldDefId: 'cf-1', value: '2026-04-27' }] } as never),
    ).resolves.toBeUndefined();
  });

  it('rejects non-true/false for BOOLEAN', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'BOOLEAN',
      options: null,
    });
    await expect(
      h.svc.bulkSetValues('co-1', { values: [{ fieldDefId: 'cf-1', value: 'maybe' }] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects SELECT value not in options', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'SELECT',
      options: ['gold', 'silver'],
    });
    await expect(
      h.svc.bulkSetValues('co-1', { values: [{ fieldDefId: 'cf-1', value: 'bronze' }] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects MULTI_SELECT with bad JSON', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'MULTI_SELECT',
      options: ['a', 'b'],
    });
    await expect(
      h.svc.bulkSetValues('co-1', { values: [{ fieldDefId: 'cf-1', value: 'not-json' }] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects MULTI_SELECT with values not in options', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'MULTI_SELECT',
      options: ['a', 'b'],
    });
    await expect(
      h.svc.bulkSetValues('co-1', {
        values: [{ fieldDefId: 'cf-1', value: '["a","c"]' }],
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('upserts a TEXT value through the composite-key upsert', async () => {
    const h = build();
    h.tx.customFieldDef.findFirst.mockResolvedValueOnce({
      id: 'cf-1',
      fieldType: 'TEXT',
      options: null,
    });
    h.tx.customFieldValue.upsert.mockResolvedValueOnce({});
    await h.svc.bulkSetValues('co-1', {
      values: [{ fieldDefId: 'cf-1', value: 'IT' }],
    } as never);
    const args = h.tx.customFieldValue.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      fieldDefId_entityId: { fieldDefId: 'cf-1', entityId: 'co-1' },
    });
    expect(args.create.value).toBe('IT');
  });
});

describe('CustomFieldsService.deleteValue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the delete to tenant+entity+field', async () => {
    const h = build();
    h.tx.customFieldValue.deleteMany.mockResolvedValueOnce({ count: 1 });
    await h.svc.deleteValue('co-1', 'cf-1');
    expect(h.tx.customFieldValue.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', entityId: 'co-1', fieldDefId: 'cf-1' },
    });
  });
});
