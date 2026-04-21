import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const mockCtx = { tenantId: 'tenant-1', userId: 'user-1' };
vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => mockCtx,
}));

import { ChatterService } from './chatter.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('ChatterService', () => {
  let svc: ChatterService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.userId = 'user-1';
    svc = new ChatterService(mockPrisma);
  });

  it('create() rejects when no authenticated user', async () => {
    mockCtx.userId = undefined as any;
    await expect(
      svc.create({ subjectType: 'DEAL', subjectId: 'd-1', body: 'hi', mentions: [] } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create() stamps tenantId and authorId', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'p-1' });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ chatterPost: { create } }));

    await svc.create({
      subjectType: 'DEAL',
      subjectId: 'd-1',
      body: 'hi',
      mentions: ['user-2'],
    } as any);

    expect(create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-1',
      authorId: 'user-1',
      subjectType: 'DEAL',
      subjectId: 'd-1',
      body: 'hi',
      mentions: ['user-2'],
    });
  });

  it('update() throws NotFoundException when post does not exist', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ chatterPost: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.update('p-1', { body: 'b' } as any)).rejects.toThrow(NotFoundException);
  });

  it('update() rejects when caller is not the author', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({
        chatterPost: {
          findFirst: vi.fn().mockResolvedValue({ id: 'p-1', authorId: 'somebody-else' }),
        },
      }),
    );
    await expect(svc.update('p-1', { body: 'b' } as any)).rejects.toThrow(ForbiddenException);
  });

  it('remove() soft-deletes via deletedAt stamp when caller is author', async () => {
    const update = vi.fn().mockResolvedValue({});
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({
        chatterPost: {
          findFirst: vi.fn().mockResolvedValue({ id: 'p-1', authorId: 'user-1' }),
          update,
        },
      }),
    );

    await svc.remove('p-1');
    expect(update).toHaveBeenCalled();
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'p-1' });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });
});
