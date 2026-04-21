import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TerritoriesService } from './territories.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('TerritoriesService', () => {
  let svc: TerritoriesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new TerritoriesService(mockPrisma);
  });

  it('create() stamps tenantId and forwards arrays', async () => {
    const create = vi.fn().mockResolvedValue({ id: 't-1' });
    mockRunWithTenant.mockImplementation(async (_t, fn) => fn({ territory: { create } }));

    await svc.create({
      name: 'NE',
      description: 'North-East',
      counties: ['IS', 'BC'],
      industries: ['RETAIL'],
    } as any);

    const arg = create.mock.calls[0][0].data;
    expect(arg).toMatchObject({
      tenantId: 'tenant-1',
      name: 'NE',
      counties: ['IS', 'BC'],
      industries: ['RETAIL'],
    });
  });

  it('findOne() throws NotFoundException when missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ territory: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.findOne('x')).rejects.toThrow(NotFoundException);
  });

  it('assign() wraps unique-constraint errors into ConflictException', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 't-1', assignments: [] });
    const create = vi.fn().mockRejectedValue(new Error('unique_violation'));
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ territory: { findFirst }, territoryAssignment: { create } }),
    );

    await expect(svc.assign('t-1', 'u-1')).rejects.toThrow(ConflictException);
  });

  it('assign() returns the created assignment on success', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 't-1', assignments: [] });
    const assignment = { territoryId: 't-1', userId: 'u-1' };
    const create = vi.fn().mockResolvedValue(assignment);
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ territory: { findFirst }, territoryAssignment: { create } }),
    );

    await expect(svc.assign('t-1', 'u-1')).resolves.toEqual(assignment);
  });

  it('unassign() uses deleteMany (idempotent)', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ territoryAssignment: { deleteMany } }),
    );

    await svc.unassign('t-1', 'u-1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { territoryId: 't-1', userId: 'u-1' } });
  });
});
