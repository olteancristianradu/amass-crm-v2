import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectsService } from './projects.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

type Mock = ReturnType<typeof vi.fn>;

describe('ProjectsService', () => {
  let svc: ProjectsService;
  let create: Mock;
  let findMany: Mock;
  let runWithTenant: Mock;
  let auditLog: Mock;
  let activitiesLog: Mock;

  beforeEach(() => {
    create = vi.fn();
    findMany = vi.fn().mockResolvedValue([]);
    runWithTenant = vi.fn(async (_tid: string, fn: (t: { project: { create: Mock; findMany: Mock } }) => unknown) =>
      fn({ project: { create, findMany } }),
    );
    auditLog = vi.fn().mockResolvedValue(undefined);
    activitiesLog = vi.fn().mockResolvedValue(undefined);

    const prisma = { runWithTenant } as unknown as ConstructorParameters<typeof ProjectsService>[0];
    const audit = { log: auditLog } as unknown as ConstructorParameters<typeof ProjectsService>[1];
    const activities = { log: activitiesLog } as unknown as ConstructorParameters<typeof ProjectsService>[2];
    svc = new ProjectsService(prisma, audit, activities);
  });

  describe('create', () => {
    it('persists project + emits audit + activity for the linked company', async () => {
      create.mockResolvedValueOnce({ id: 'p-1', name: 'Migrate', companyId: 'co-1' });

      const out = await svc.create({
        companyId: 'co-1',
        name: 'Migrate',
        status: 'PLANNED',
        currency: 'RON',
      } as never);

      expect(out.id).toBe('p-1');
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          companyId: 'co-1',
          name: 'Migrate',
          status: 'PLANNED',
          createdById: 'user-1',
        }),
      }));
      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.create' }));
      expect(activitiesLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'project.created',
        subjectType: 'COMPANY',
        subjectId: 'co-1',
      }));
    });

    it('translates Prisma P2002 (unique deal) to PROJECT_DEAL_TAKEN conflict', async () => {
      const e = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      });
      create.mockRejectedValueOnce(e);

      await expect(
        svc.create({ companyId: 'co-1', dealId: 'd-1', name: 'X', status: 'PLANNED', currency: 'RON' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes budget through Prisma.Decimal when provided', async () => {
      create.mockResolvedValueOnce({ id: 'p-1', name: 'X', companyId: 'co-1' });
      await svc.create({ companyId: 'co-1', name: 'X', status: 'PLANNED', currency: 'RON', budget: '5000.50' } as never);
      const args = create.mock.calls[0][0] as { data: { budget: unknown } };
      expect(args.data.budget).toBeInstanceOf(Prisma.Decimal);
    });
  });

  describe('list', () => {
    it('filters by companyId and status when provided', async () => {
      await svc.list({ limit: 25, companyId: 'co-1', status: 'IN_PROGRESS' } as never);
      const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({
        tenantId: 'tenant-1',
        deletedAt: null,
        companyId: 'co-1',
        status: 'IN_PROGRESS',
      });
    });

    it('omits filters when not provided', async () => {
      await svc.list({ limit: 25 } as never);
      const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where).toEqual({ tenantId: 'tenant-1', deletedAt: null });
    });
  });
});
