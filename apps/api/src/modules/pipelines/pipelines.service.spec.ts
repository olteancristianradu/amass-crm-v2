import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelinesService } from './pipelines.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    pipeline: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    pipelineStage: {
      findFirst: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof PipelinesService>[0];
  const svc = new PipelinesService(prisma);
  return { svc, prisma, tx };
}

const stubStage = (overrides = {}) => ({
  id: 's-1',
  name: 'Qualification',
  order: 0,
  type: 'OPEN',
  pipelineId: 'p-1',
  tenantId: 'tenant-1',
  deletedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const stubPipeline = (overrides = {}) => ({
  id: 'p-1',
  name: 'Sales',
  isDefault: true,
  order: 0,
  tenantId: 'tenant-1',
  deletedAt: null,
  createdAt: new Date(),
  stages: [stubStage()],
  ...overrides,
});

describe('PipelinesService.listAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries by tenantId + deletedAt:null and includes stages', async () => {
    const h = build();
    h.tx.pipeline.findMany.mockResolvedValueOnce([stubPipeline()]);
    const result = await h.svc.listAll();
    expect(h.tx.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', deletedAt: null },
        include: expect.objectContaining({ stages: expect.anything() }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].stages).toHaveLength(1);
  });

  it('orders by isDefault desc, then order asc, then createdAt asc', async () => {
    const h = build();
    h.tx.pipeline.findMany.mockResolvedValueOnce([]);
    await h.svc.listAll();
    const orderBy = h.tx.pipeline.findMany.mock.calls[0][0].orderBy;
    expect(orderBy[0]).toEqual({ isDefault: 'desc' });
    expect(orderBy[1]).toEqual({ order: 'asc' });
    expect(orderBy[2]).toEqual({ createdAt: 'asc' });
  });

  it('returns empty array when no pipelines exist', async () => {
    const h = build();
    h.tx.pipeline.findMany.mockResolvedValueOnce([]);
    const result = await h.svc.listAll();
    expect(result).toEqual([]);
  });
});

describe('PipelinesService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns pipeline with stages when found', async () => {
    const h = build();
    h.tx.pipeline.findFirst.mockResolvedValueOnce(stubPipeline());
    const result = await h.svc.findOne('p-1');
    expect(h.tx.pipeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-1', tenantId: 'tenant-1', deletedAt: null },
      }),
    );
    expect(result).toMatchObject({ id: 'p-1', name: 'Sales' });
    expect(result.stages).toHaveLength(1);
  });

  it('throws NotFoundException with code PIPELINE_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.pipeline.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PIPELINE_NOT_FOUND' }),
    });
  });
});

describe('PipelinesService.getDefault', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the default pipeline (isDefault=true, highest priority)', async () => {
    const h = build();
    h.tx.pipeline.findFirst.mockResolvedValueOnce(stubPipeline({ isDefault: true }));
    const result = await h.svc.getDefault();
    expect(result).toMatchObject({ id: 'p-1', isDefault: true });
  });

  it('throws NotFoundException with code PIPELINE_NOT_FOUND when no pipelines exist', async () => {
    const h = build();
    h.tx.pipeline.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.getDefault()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PIPELINE_NOT_FOUND' }),
    });
  });

  it('orders by isDefault desc to prefer the default pipeline', async () => {
    const h = build();
    h.tx.pipeline.findFirst.mockResolvedValueOnce(stubPipeline());
    await h.svc.getDefault();
    const orderBy = h.tx.pipeline.findFirst.mock.calls[0][0].orderBy;
    expect(orderBy[0]).toEqual({ isDefault: 'desc' });
  });
});

describe('PipelinesService.findStage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a stage when found by pipelineId + stageId + tenantId', async () => {
    const h = build();
    h.tx.pipelineStage.findFirst.mockResolvedValueOnce(stubStage());
    const result = await h.svc.findStage('p-1', 's-1');
    expect(h.tx.pipelineStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 's-1',
          pipelineId: 'p-1',
          tenantId: 'tenant-1',
          deletedAt: null,
        },
      }),
    );
    expect(result).toMatchObject({ id: 's-1', pipelineId: 'p-1' });
  });

  it('throws NotFoundException with code STAGE_NOT_FOUND when stage is missing', async () => {
    const h = build();
    h.tx.pipelineStage.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findStage('p-1', 'ghost')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STAGE_NOT_FOUND' }),
    });
  });

  it('does not cross tenant boundary — tenantId is always in the where clause', async () => {
    const h = build();
    h.tx.pipelineStage.findFirst.mockResolvedValueOnce(null);
    await h.svc.findStage('p-1', 's-1').catch(() => undefined);
    const where = h.tx.pipelineStage.findFirst.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
  });
});
