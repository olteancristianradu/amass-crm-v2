import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { ImporterService } from './importer.service';

function build(opts: { perTenantPending?: number; activeQueueDepth?: number } = {}) {
  const tx = {
    importJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ImporterService>[0];
  const storage = {
    putObject: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof ImporterService>[1];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ImporterService>[2];
  const fakeJobs = Array.from({ length: opts.perTenantPending ?? 0 }, () => ({
    data: { tenantId: 'tenant-1' },
  }));
  const queue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getJobCounts: vi
      .fn()
      .mockResolvedValue({ waiting: 0, active: opts.activeQueueDepth ?? 0 }),
    getJobs: vi.fn().mockResolvedValue(fakeJobs),
  } as unknown as ConstructorParameters<typeof ImporterService>[3];
  const svc = new ImporterService(prisma, storage, audit, queue);
  return { svc, prisma, tx, storage, audit, queue };
}

describe('ImporterService.enqueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads to MinIO BEFORE creating the row (fail-fast on storage outage)', async () => {
    const h = build();
    h.tx.importJob.create.mockResolvedValueOnce({ id: 'imp-1' });
    await h.svc.enqueue({
      type: 'COMPANIES' as never,
      fileName: 'companies.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('a,b,c'),
    });
    const putOrder = vi.mocked(h.storage.putObject).mock.invocationCallOrder[0];
    const createOrder = h.tx.importJob.create.mock.invocationCallOrder[0];
    expect(putOrder).toBeLessThan(createOrder);
  });

  it('builds storageKey as `<tenantId>/imports/<uuid>-<sanitised>`', async () => {
    const h = build();
    h.tx.importJob.create.mockResolvedValueOnce({ id: 'imp-1' });
    await h.svc.enqueue({
      type: 'COMPANIES' as never,
      fileName: 'a/b/Naughty Name <script>.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(''),
    });
    const data = h.tx.importJob.create.mock.calls[0][0].data;
    expect(data.storageKey.startsWith('tenant-1/imports/')).toBe(true);
    expect(/[<>]|\//.test(data.storageKey.replace('tenant-1/imports/', ''))).toBe(false);
  });

  it('uses lower priority when this tenant has > 5 pending jobs (fair-queue)', async () => {
    const h = build({ perTenantPending: 6 });
    h.tx.importJob.create.mockResolvedValueOnce({ id: 'imp-1' });
    await h.svc.enqueue({
      type: 'COMPANIES' as never,
      fileName: 'a.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(''),
    });
    const opts = vi.mocked(h.queue.add).mock.calls[0][2];
    expect(opts!.priority).toBe(10);
  });

  it('uses default priority when global active depth is small', async () => {
    const h = build({ activeQueueDepth: 5, perTenantPending: 1 });
    h.tx.importJob.create.mockResolvedValueOnce({ id: 'imp-1' });
    await h.svc.enqueue({
      type: 'COMPANIES' as never,
      fileName: 'a.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(''),
    });
    const opts = vi.mocked(h.queue.add).mock.calls[0][2];
    expect(opts!.priority).toBe(1);
  });

  it('uses jobId = importJob.id for idempotency on the BullMQ side', async () => {
    const h = build();
    h.tx.importJob.create.mockResolvedValueOnce({ id: 'imp-XYZ' });
    await h.svc.enqueue({
      type: 'COMPANIES' as never,
      fileName: 'a.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(''),
    });
    expect(vi.mocked(h.queue.add).mock.calls[0][2]!.jobId).toBe('imp-XYZ');
  });

  it('audits import.create', async () => {
    const h = build();
    h.tx.importJob.create.mockResolvedValueOnce({ id: 'imp-1' });
    await h.svc.enqueue({
      type: 'COMPANIES' as never,
      fileName: 'a.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(''),
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'import.create' }),
    );
  });
});

describe('ImporterService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws IMPORT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.importJob.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('ImporterService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orders newest first and respects limit', async () => {
    const h = build();
    h.tx.importJob.findMany.mockResolvedValueOnce([]);
    await h.svc.list(50);
    const args = h.tx.importJob.findMany.mock.calls[0][0];
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
