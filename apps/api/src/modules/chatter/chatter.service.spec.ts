import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const mockCtx: { tenantId: string; userId: string | undefined } = {
  tenantId: 'tenant-1',
  userId: 'user-1',
};
vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => mockCtx,
}));

import { ChatterService } from './chatter.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;
const mockNotificationsCreate = vi.fn();
const mockNotifications = { create: mockNotificationsCreate } as any;

describe('ChatterService', () => {
  let svc: ChatterService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.userId = 'user-1';
    mockNotificationsCreate.mockResolvedValue({ id: 'n-1' });
    svc = new ChatterService(mockPrisma, mockNotifications);
  });

  it('create() rejects when no authenticated user', async () => {
    mockCtx.userId = undefined;
    await expect(
      svc.create({ subjectType: 'DEAL', subjectId: 'd-1', body: 'hi', mentions: [] } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create() stamps tenantId and authorId', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'p-1', subjectType: 'DEAL', subjectId: 'd-1' });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ chatterPost: { create } }));

    await svc.create({
      subjectType: 'DEAL',
      subjectId: 'd-1',
      body: 'hi',
      mentions: [],
    } as any);

    expect(create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-1',
      authorId: 'user-1',
      subjectType: 'DEAL',
      subjectId: 'd-1',
      body: 'hi',
    });
  });

  it('create() fans out notifications to mentioned users (excluding self)', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: 'p-1', subjectType: 'DEAL', subjectId: 'd-1' });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ chatterPost: { create } }));

    await svc.create({
      subjectType: 'DEAL',
      subjectId: 'd-1',
      body: 'hey team',
      mentions: ['user-2', 'user-1', 'user-3'], // self (user-1) must be skipped
    } as any);

    // Notifications are fire-and-forget; allow the microtask queue to drain.
    await Promise.resolve();

    expect(mockNotificationsCreate).toHaveBeenCalledTimes(2);
    const mentionedIds = mockNotificationsCreate.mock.calls.map((c) => c[1].userId);
    expect(mentionedIds).toEqual(expect.arrayContaining(['user-2', 'user-3']));
    expect(mentionedIds).not.toContain('user-1');
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
