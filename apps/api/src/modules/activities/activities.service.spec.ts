import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ActivitiesService } from './activities.service';

const ctx = { tenantId: 'tenant-1', userId: 'user-1' };
let ctxValue: typeof ctx | null = ctx;

vi.mock('../../infra/prisma/tenant-context', () => ({
  getTenantContext: () => ctxValue,
}));

describe('ActivitiesService', () => {
  let svc: ActivitiesService;
  let create: ReturnType<typeof vi.fn>;
  let runWithTenant: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctxValue = ctx;
    create = vi.fn().mockResolvedValue({});
    runWithTenant = vi.fn(async (_tid: string, fn: (t: { activity: { create: typeof create } }) => Promise<unknown>) =>
      fn({ activity: { create } }),
    );
    const prisma = { runWithTenant } as unknown as ConstructorParameters<typeof ActivitiesService>[0];
    svc = new ActivitiesService(prisma);
  });

  it('writes an activity row with tenantId, subject, actor, action, metadata', async () => {
    await svc.log({
      subjectType: 'COMPANY',
      subjectId: 'co-1',
      action: 'company.created',
      metadata: { name: 'Alfa Tech' },
    });

    expect(runWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        subjectType: 'COMPANY',
        subjectId: 'co-1',
        actorId: 'user-1',
        action: 'company.created',
      }),
    });
  });

  it('drops the activity (no throw) when there is no tenant context', async () => {
    ctxValue = null;
    await expect(
      svc.log({ subjectType: 'COMPANY', subjectId: 'co-1', action: 'x' }),
    ).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not throw when the DB write fails (best-effort)', async () => {
    create.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.log({ subjectType: 'CONTACT', subjectId: 'c-1', action: 'note.added' }),
    ).resolves.toBeUndefined();
  });

  it('uses Prisma.JsonNull when metadata is omitted', async () => {
    await svc.log({ subjectType: 'COMPANY', subjectId: 'co-1', action: 'company.deleted' });
    const arg = create.mock.calls[0][0] as { data: { metadata: unknown } };
    // Prisma.JsonNull is a sentinel object; we just assert it's present (not undefined).
    expect(arg.data.metadata).toBeDefined();
  });
});
