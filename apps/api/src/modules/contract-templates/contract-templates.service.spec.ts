import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractTemplatesService } from './contract-templates.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    contractTemplate: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    contract: { count: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ContractTemplatesService>[0];
  const svc = new ContractTemplatesService(prisma);
  return { svc, prisma, tx };
}

describe('ContractTemplatesService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists tenant + version=1 + creator', async () => {
    const h = build();
    h.tx.contractTemplate.create.mockResolvedValueOnce({ id: 't1' });
    await h.svc.create({
      name: 'Mentenanță',
      bodyMd: '# Title',
      variables: [{ key: 'x', type: 'string', required: false }],
    } as never);
    const data = h.tx.contractTemplate.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.createdById).toBe('user-1');
    expect(data.version).toBe(1);
  });

  it('rejects duplicate variable keys with 400', async () => {
    const h = build();
    await expect(
      h.svc.create({
        name: 'X',
        bodyMd: 'body',
        variables: [
          { key: 'a', type: 'string', required: false },
          { key: 'a', type: 'string', required: false },
        ],
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('maps Prisma P2002 to 409 TEMPLATE_NAME_TAKEN', async () => {
    const h = build();
    h.tx.contractTemplate.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6.0' }),
    );
    await expect(
      h.svc.create({ name: 'X', bodyMd: 'body', variables: [] } as never),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ContractTemplatesService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws TEMPLATE_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('ContractTemplatesService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows free updates on DRAFT templates', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce({ id: 't1', status: 'DRAFT' });
    h.tx.contractTemplate.update.mockResolvedValueOnce({ id: 't1' });
    await h.svc.update('t1', { bodyMd: 'new body' } as never);
    expect(h.tx.contract.count).not.toHaveBeenCalled();
  });

  it('blocks bodyMd mutation on PUBLISHED templates that are in use', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce({ id: 't1', status: 'PUBLISHED' });
    h.tx.contract.count.mockResolvedValueOnce(3); // 3 contracts reference this template
    await expect(
      h.svc.update('t1', { bodyMd: 'mutated' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows status-only transitions (PUBLISHED → ARCHIVED)', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce({ id: 't1', status: 'PUBLISHED' });
    h.tx.contractTemplate.update.mockResolvedValueOnce({ id: 't1' });
    await h.svc.update('t1', { status: 'ARCHIVED' } as never);
    expect(h.tx.contract.count).not.toHaveBeenCalled();
  });
});

describe('ContractTemplatesService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks deletedAt + ARCHIVED on soft delete', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce({ id: 't1', status: 'PUBLISHED', deletedAt: null });
    h.tx.contractTemplate.update.mockResolvedValueOnce({ id: 't1' });
    await h.svc.remove('t1');
    const data = h.tx.contractTemplate.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.status).toBe('ARCHIVED');
  });

  it('is idempotent on already-deleted templates', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce({
      id: 't1',
      status: 'ARCHIVED',
      deletedAt: new Date(),
    });
    await h.svc.remove('t1');
    expect(h.tx.contractTemplate.update).not.toHaveBeenCalled();
  });
});

describe('ContractTemplatesService.publishNewVersion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clones with version+1 and PUBLISHED status', async () => {
    const h = build();
    h.tx.contractTemplate.findFirst.mockResolvedValueOnce({
      id: 't1',
      name: 'X',
      description: 'd',
      bodyMd: 'old',
      variables: [],
      version: 2,
    });
    h.tx.contractTemplate.create.mockResolvedValueOnce({ id: 't2' });
    await h.svc.publishNewVersion('t1', { bodyMd: 'new' });
    const data = h.tx.contractTemplate.create.mock.calls[0][0].data;
    expect(data.version).toBe(3);
    expect(data.status).toBe('PUBLISHED');
    expect(data.bodyMd).toBe('new');
  });
});
