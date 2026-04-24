import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DealsService } from './deals.service';

/**
 * DealsService has five public entry points (create, list, findOne, update,
 * move, remove, forecast) and one private helper (nextOrderInStage). The
 * tricky logic lives in `move` — stage/pipeline coherence, LOST reason
 * requirement, WON auto-project spin, closedAt transitions — so most tests
 * target that. Every path goes through runWithTenant which we stub to call
 * the callback with a tx double so our mocks intercept the .deal.* calls.
 */

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

type StageType = 'OPEN' | 'WON' | 'LOST';

// Partial PipelineStage — cast via `as never` because DealsService only
// reads `type`, `name`, `id` from the returned object. Full Prisma type
// would force dozens of irrelevant fields per call.
function makeStage(type: StageType = 'OPEN', id = 'stage-1'): never {
  return { id, name: `Stage ${id}`, type } as never;
}

function makeDeal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'deal-1',
    tenantId: 'tenant-1',
    pipelineId: 'pipe-1',
    stageId: 'stage-1',
    title: 'ACME deal',
    description: null,
    value: new Prisma.Decimal(1000),
    currency: 'RON',
    probability: null,
    expectedCloseAt: null,
    companyId: 'company-1',
    contactId: null,
    ownerId: null,
    status: 'OPEN' as const,
    closedAt: null,
    orderInStage: 10,
    deletedAt: null,
    lostReason: null,
    createdById: 'user-1',
    ...overrides,
  };
}

function build() {
  const tx = {
    deal: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { orderInStage: null } }),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof DealsService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof DealsService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof DealsService>[2];
  const pipelines = {
    findStage: vi.fn().mockResolvedValue(makeStage('OPEN')),
  } as unknown as ConstructorParameters<typeof DealsService>[3];
  const workflows = {
    trigger: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof DealsService>[4];
  const projects = {
    createFromDeal: vi.fn().mockResolvedValue(null),
  } as unknown as ConstructorParameters<typeof DealsService>[5];
  const svc = new DealsService(prisma, audit, activities, pipelines, workflows, projects);
  return { svc, prisma, tx, audit, activities, pipelines, workflows, projects };
}

describe('DealsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the deal, derives status from stage, orderInStage=10 on empty column', async () => {
    const h = build();
    h.tx.deal.create.mockResolvedValue(makeDeal());
    const out = await h.svc.create({
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
      title: 'ACME deal',
      value: 1000,
      currency: 'RON',
      companyId: 'company-1',
    } as never);
    expect(h.tx.deal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          pipelineId: 'pipe-1',
          stageId: 'stage-1',
          status: 'OPEN',
          closedAt: null,
          orderInStage: 10,
          createdById: 'user-1',
        }),
      }),
    );
    expect(out.id).toBe('deal-1');
  });

  it('sets closedAt when created directly in a WON stage', async () => {
    const h = build();
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('WON'));
    h.tx.deal.create.mockResolvedValue(makeDeal({ status: 'WON', closedAt: new Date() }));
    await h.svc.create({
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
      title: 'Won directly',
      currency: 'RON',
    } as never);
    const callArg = h.tx.deal.create.mock.calls[0]![0] as { data: { status: string; closedAt: unknown } };
    expect(callArg.data.status).toBe('WON');
    expect(callArg.data.closedAt).toBeInstanceOf(Date);
  });

  it('appends orderInStage = max + 10 when column already has deals', async () => {
    const h = build();
    h.tx.deal.aggregate.mockResolvedValue({ _max: { orderInStage: 40 } });
    h.tx.deal.create.mockResolvedValue(makeDeal({ orderInStage: 50 }));
    await h.svc.create({
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
      title: 'Third deal',
      currency: 'RON',
    } as never);
    const callArg = h.tx.deal.create.mock.calls[0]![0] as { data: { orderInStage: number } };
    expect(callArg.data.orderInStage).toBe(50);
  });

  it('logs a COMPANY activity when companyId is set', async () => {
    const h = build();
    h.tx.deal.create.mockResolvedValue(makeDeal({ companyId: 'c-1', contactId: null }));
    await h.svc.create({
      pipelineId: 'pipe-1', stageId: 'stage-1', title: 't', currency: 'RON', companyId: 'c-1',
    } as never);
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'COMPANY', subjectId: 'c-1', action: 'deal.created' }),
    );
  });

  it('falls back to CONTACT activity when companyId is absent but contactId is set', async () => {
    const h = build();
    h.tx.deal.create.mockResolvedValue(makeDeal({ companyId: null, contactId: 'ct-1' }));
    await h.svc.create({
      pipelineId: 'pipe-1', stageId: 'stage-1', title: 't', currency: 'RON', contactId: 'ct-1',
    } as never);
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'CONTACT', subjectId: 'ct-1' }),
    );
  });

  it('skips activity log when neither company nor contact is linked', async () => {
    const h = build();
    h.tx.deal.create.mockResolvedValue(makeDeal({ companyId: null, contactId: null }));
    await h.svc.create({
      pipelineId: 'pipe-1', stageId: 'stage-1', title: 't', currency: 'RON',
    } as never);
    expect(h.activities.log).not.toHaveBeenCalled();
  });

  it('fires DEAL_CREATED workflow trigger (fire-and-forget)', async () => {
    const h = build();
    h.tx.deal.create.mockResolvedValue(makeDeal());
    await h.svc.create({
      pipelineId: 'pipe-1', stageId: 'stage-1', title: 't', currency: 'RON',
    } as never);
    // `void` on trigger — but since we awaited create, the microtask has flushed
    await Promise.resolve();
    expect(h.workflows.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'DEAL_CREATED', subjectId: 'deal-1', tenantId: 'tenant-1' }),
    );
  });
});

describe('DealsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty page for zero matches', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([]);
    const out = await h.svc.list({ limit: 20 } as never);
    expect(out.data).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it('applies pipelineId/stageId/status filters', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([]);
    await h.svc.list({
      limit: 20,
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
      status: 'OPEN',
      ownerId: 'u-1',
      companyId: 'c-1',
      contactId: 'ct-1',
    } as never);
    const arg = h.tx.deal.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({
      tenantId: 'tenant-1',
      deletedAt: null,
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
      status: 'OPEN',
      ownerId: 'u-1',
      companyId: 'c-1',
      contactId: 'ct-1',
    });
  });

  it('applies full-text OR filter when q is set', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([]);
    await h.svc.list({ limit: 20, q: 'foo' } as never);
    const arg = h.tx.deal.findMany.mock.calls[0]![0] as { where: { OR?: unknown } };
    expect(arg.where.OR).toBeDefined();
  });

  it('applies cursor pagination with skip=1', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([makeDeal()]);
    await h.svc.list({ limit: 20, cursor: 'deal-prev' } as never);
    const arg = h.tx.deal.findMany.mock.calls[0]![0] as { cursor: unknown; skip: number };
    expect(arg.cursor).toEqual({ id: 'deal-prev' });
    expect(arg.skip).toBe(1);
  });
});

describe('DealsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the deal when found', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    const out = await h.svc.findOne('deal-1');
    expect(out.id).toBe('deal-1');
  });

  it('throws NotFoundException with DEAL_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(null);
    await expect(h.svc.findOne('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('DealsService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only supplied fields and logs an audit entry', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    h.tx.deal.update.mockResolvedValue(makeDeal({ title: 'new title' }));
    await h.svc.update('deal-1', { title: 'new title' } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ title: 'new title' });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deal.update', subjectId: 'deal-1' }),
    );
  });

  it('wraps numeric value in Prisma.Decimal', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    h.tx.deal.update.mockResolvedValue(makeDeal());
    await h.svc.update('deal-1', { value: 5000 } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { value: unknown } };
    expect(arg.data.value).toBeInstanceOf(Prisma.Decimal);
  });

  it('passes null through explicitly when value is null', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    h.tx.deal.update.mockResolvedValue(makeDeal());
    await h.svc.update('deal-1', { value: null } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { value: unknown } };
    expect(arg.data.value).toBeNull();
  });

  it('skips activity log when deal had no linked company', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal({ companyId: null }));
    h.tx.deal.update.mockResolvedValue(makeDeal({ companyId: null }));
    await h.svc.update('deal-1', { title: 't2' } as never);
    expect(h.activities.log).not.toHaveBeenCalled();
  });

  it('propagates NotFound from findOne', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(null);
    await expect(h.svc.update('ghost', { title: 'x' } as never)).rejects.toThrow(NotFoundException);
  });
});

describe('DealsService.move', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves to a new OPEN stage, clears closedAt, appends orderInStage', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('OPEN', 'stage-2'));
    h.tx.deal.aggregate.mockResolvedValue({ _max: { orderInStage: 20 } });
    h.tx.deal.update.mockResolvedValue(makeDeal({ stageId: 'stage-2', orderInStage: 30 }));
    await h.svc.move('deal-1', { stageId: 'stage-2' } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { stageId: string; status: string; closedAt: unknown; orderInStage: number } };
    expect(arg.data.stageId).toBe('stage-2');
    expect(arg.data.status).toBe('OPEN');
    expect(arg.data.closedAt).toBeNull();
    expect(arg.data.orderInStage).toBe(30);
  });

  it('respects an explicit orderInStage instead of aggregating', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('OPEN', 'stage-2'));
    h.tx.deal.update.mockResolvedValue(makeDeal());
    await h.svc.move('deal-1', { stageId: 'stage-2', orderInStage: 15 } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { orderInStage: number } };
    expect(arg.data.orderInStage).toBe(15);
    expect(h.tx.deal.aggregate).not.toHaveBeenCalled();
  });

  it('rejects a LOST move without a lostReason (LOST_REASON_REQUIRED)', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('LOST', 'stage-lost'));
    await expect(h.svc.move('deal-1', { stageId: 'stage-lost' } as never)).rejects.toThrow(BadRequestException);
    expect(h.tx.deal.update).not.toHaveBeenCalled();
  });

  it('accepts a LOST move when lostReason is given; stores status=LOST + lostReason', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('LOST', 'stage-lost'));
    h.tx.deal.update.mockResolvedValue(makeDeal({ status: 'LOST', lostReason: 'price' }));
    await h.svc.move('deal-1', { stageId: 'stage-lost', lostReason: 'price' } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { status: string; lostReason: string; closedAt: unknown } };
    expect(arg.data.status).toBe('LOST');
    expect(arg.data.lostReason).toBe('price');
    expect(arg.data.closedAt).toBeInstanceOf(Date);
  });

  it('preserves existing closedAt when moving between two closed stages (does not bump the date)', async () => {
    const h = build();
    const earlier = new Date('2024-01-01');
    h.tx.deal.findFirst.mockResolvedValue(makeDeal({ status: 'LOST', closedAt: earlier }));
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('LOST', 'stage-lost-2'));
    h.tx.deal.update.mockResolvedValue(makeDeal());
    await h.svc.move('deal-1', { stageId: 'stage-lost-2', lostReason: 'still lost' } as never);
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { closedAt: Date } };
    expect(arg.data.closedAt).toBe(earlier);
  });

  it('auto-creates a project when moving into a WON stage', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('WON', 'stage-won'));
    h.tx.deal.update.mockResolvedValue(makeDeal({ id: 'deal-1', status: 'WON' }));
    await h.svc.move('deal-1', { stageId: 'stage-won' } as never);
    expect(h.projects.createFromDeal).toHaveBeenCalledWith('deal-1');
  });

  it('swallows project auto-creation failures (never blocks the move)', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('WON', 'stage-won'));
    h.tx.deal.update.mockResolvedValue(makeDeal({ id: 'deal-1', status: 'WON' }));
    vi.mocked(h.projects.createFromDeal).mockRejectedValue(new Error('project svc down'));
    await expect(h.svc.move('deal-1', { stageId: 'stage-won' } as never)).resolves.toBeTruthy();
  });

  it('fires DEAL_STAGE_CHANGED workflow trigger with the new stageId', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('OPEN', 'stage-2'));
    h.tx.deal.update.mockResolvedValue(makeDeal({ stageId: 'stage-2' }));
    await h.svc.move('deal-1', { stageId: 'stage-2' } as never);
    await Promise.resolve();
    expect(h.workflows.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'DEAL_STAGE_CHANGED', stageId: 'stage-2' }),
    );
  });

  it('logs an activity keyed on the new status (deal.won / deal.lost / deal.open)', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal({ companyId: 'c-1' }));
    vi.mocked(h.pipelines.findStage).mockResolvedValue(makeStage('WON', 'stage-won'));
    h.tx.deal.update.mockResolvedValue(makeDeal({ status: 'WON' }));
    await h.svc.move('deal-1', { stageId: 'stage-won' } as never);
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'COMPANY', action: 'deal.won' }),
    );
  });
});

describe('DealsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-deletes (sets deletedAt) and audit-logs', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal());
    h.tx.deal.update.mockResolvedValue(makeDeal());
    await h.svc.remove('deal-1');
    const arg = h.tx.deal.update.mock.calls[0]![0] as { data: { deletedAt: Date } };
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deal.delete', subjectId: 'deal-1' }),
    );
  });

  it('logs a deal.deleted activity on the linked company', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(makeDeal({ companyId: 'c-1' }));
    h.tx.deal.update.mockResolvedValue(makeDeal());
    await h.svc.remove('deal-1');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'COMPANY', subjectId: 'c-1', action: 'deal.deleted' }),
    );
  });

  it('throws NotFound when the deal is missing', async () => {
    const h = build();
    h.tx.deal.findFirst.mockResolvedValue(null);
    await expect(h.svc.remove('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('DealsService.forecast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty forecast when there are no open deals', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([]);
    const out = await h.svc.forecast();
    expect(out).toEqual({ stages: [], totalRaw: 0, totalWeighted: 0 });
  });

  it('scopes by pipelineId when supplied', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([]);
    await h.svc.forecast('pipe-xyz');
    const arg = h.tx.deal.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where.pipelineId).toBe('pipe-xyz');
    expect(arg.where.status).toBe('OPEN');
    expect(arg.where.deletedAt).toBeNull();
  });

  it('aggregates weighted value from live deals through aggregateForecast', async () => {
    const h = build();
    h.tx.deal.findMany.mockResolvedValue([
      {
        id: 'd1',
        title: 'D1',
        value: 1000,
        currency: 'RON',
        probability: 80,
        stageId: 's1',
        stage: { id: 's1', name: 'Proposal', probability: 50 },
      },
    ]);
    const out = await h.svc.forecast();
    expect(out.totalRaw).toBe(1000);
    expect(out.totalWeighted).toBe(800); // 1000 * 0.80 from deal probability
  });
});
