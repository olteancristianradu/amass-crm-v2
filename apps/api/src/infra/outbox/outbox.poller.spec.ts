import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxEventStatus } from '@prisma/client';
import { OUTBOX_MAX_ATTEMPTS, OutboxPoller } from './outbox.poller';

type Mock = ReturnType<typeof vi.fn>;

function makeJob(name = 'drain') {
  return { name } as { name: string };
}

function buildPrisma(overrides: {
  findMany?: Mock;
  endpointFindMany?: Mock;
  update?: Mock;
  // Phase 1.1 HIGH-3: tenant filter (active + not suspended) added to the
  // poller's drain loop. Defaults to "all candidate tenants active" so the
  // existing tests keep their old behaviour.
  tenantFindMany?: Mock;
}): {
  prisma: {
    outboxEvent: { findMany: Mock; update: Mock };
    webhookEndpoint: unknown;
    tenant: { findMany: Mock };
    runWithTenant: Mock;
  };
  endpointFindMany: Mock;
  update: Mock;
  tenantFindMany: Mock;
} {
  const findMany = overrides.findMany ?? vi.fn().mockResolvedValue([]);
  const update = overrides.update ?? vi.fn().mockResolvedValue({ attempts: 1 });
  const endpointFindMany = overrides.endpointFindMany ?? vi.fn().mockResolvedValue([]);
  // Default: every queried tenant looks active. Negative tests override.
  const tenantFindMany = overrides.tenantFindMany ?? vi.fn().mockImplementation(
    async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in.map((id) => ({ id })),
  );
  const runWithTenant = vi.fn().mockImplementation(
    async (
      _tenantId: string,
      fn: (tx: { webhookEndpoint: { findMany: Mock } }) => Promise<unknown>,
    ) => fn({ webhookEndpoint: { findMany: endpointFindMany } }),
  );
  return {
    prisma: {
      outboxEvent: { findMany, update },
      webhookEndpoint: undefined,
      tenant: { findMany: tenantFindMany },
      runWithTenant,
    },
    endpointFindMany,
    update,
    tenantFindMany,
  };
}

function buildMetrics() {
  return {
    setOutboxLagSeconds: vi.fn(),
    recordOutboxProcessed: vi.fn(),
    recordWebhookDelivery: vi.fn(),
  };
}

function makePoller(opts: {
  prisma: unknown;
  queueAdd?: Mock;
  metrics?: ReturnType<typeof buildMetrics>;
}): OutboxPoller {
  const queueAdd = opts.queueAdd ?? vi.fn().mockResolvedValue({});
  const metrics = opts.metrics ?? buildMetrics();
  // Bypass DI — construct directly with the minimal shape each call uses.
  return new OutboxPoller(
    opts.prisma as never,
    { add: queueAdd } as never,
    metrics as never,
  );
}

describe('OutboxPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores jobs with the wrong name', async () => {
    const { prisma } = buildPrisma({});
    const poller = makePoller({ prisma });
    await poller.process(makeJob('not-drain') as never);
    expect(prisma.outboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('reports 0 lag and exits when no pending rows', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { prisma } = buildPrisma({ findMany });
    const metrics = buildMetrics();
    const poller = makePoller({ prisma, metrics });

    await poller.process(makeJob() as never);

    expect(metrics.setOutboxLagSeconds).toHaveBeenCalledWith(0);
    expect(metrics.recordOutboxProcessed).not.toHaveBeenCalled();
  });

  it('computes lag from the oldest row in the batch', async () => {
    const oldest = new Date(Date.now() - 12_000);
    const findMany = vi.fn().mockResolvedValue([
      { id: 'row1', tenantId: 't1', eventType: 'UNKNOWN_EVENT', payload: {}, createdAt: oldest },
    ]);
    const update = vi.fn().mockResolvedValue({ attempts: 1 });
    const { prisma } = buildPrisma({ findMany, update });
    const metrics = buildMetrics();
    const poller = makePoller({ prisma, metrics });

    await poller.process(makeJob() as never);

    const lagArg = metrics.setOutboxLagSeconds.mock.calls[0]?.[0] as number;
    expect(lagArg).toBeGreaterThanOrEqual(11);
    expect(lagArg).toBeLessThan(20);
  });

  it('marks an unknown eventType PUBLISHED with no fan-out + counts as skipped', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'row1', tenantId: 't1', eventType: 'NOT_A_REAL_EVENT', payload: {}, createdAt: new Date() },
    ]);
    const update = vi.fn().mockResolvedValue({ attempts: 1 });
    const { prisma } = buildPrisma({ findMany, update });
    const queueAdd = vi.fn();
    const metrics = buildMetrics();
    const poller = makePoller({ prisma, queueAdd, metrics });

    await poller.process(makeJob() as never);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row1' },
      data: expect.objectContaining({ status: OutboxEventStatus.PUBLISHED }),
    }));
    expect(metrics.recordOutboxProcessed).toHaveBeenCalledWith('skipped');
  });

  it('marks PUBLISHED + counts as skipped when no endpoints subscribe to the event', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'row1', tenantId: 't1', eventType: 'DEAL_CREATED', payload: {}, createdAt: new Date() },
    ]);
    const endpointFindMany = vi.fn().mockResolvedValue([]);
    const update = vi.fn().mockResolvedValue({ attempts: 1 });
    const { prisma } = buildPrisma({ findMany, endpointFindMany, update });
    const queueAdd = vi.fn();
    const metrics = buildMetrics();
    const poller = makePoller({ prisma, queueAdd, metrics });

    await poller.process(makeJob() as never);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(metrics.recordOutboxProcessed).toHaveBeenCalledWith('skipped');
  });

  it('enqueues one delivery per matching endpoint with a deterministic jobId', async () => {
    const row = { id: 'row1', tenantId: 't1', eventType: 'DEAL_CREATED', payload: { id: 'd1' }, createdAt: new Date() };
    const findMany = vi.fn().mockResolvedValue([row]);
    const endpointFindMany = vi.fn().mockResolvedValue([{ id: 'ep-a' }, { id: 'ep-b' }]);
    const update = vi.fn().mockResolvedValue({ attempts: 1 });
    const { prisma } = buildPrisma({ findMany, endpointFindMany, update });
    const queueAdd = vi.fn().mockResolvedValue({});
    const metrics = buildMetrics();
    const poller = makePoller({ prisma, queueAdd, metrics });

    await poller.process(makeJob() as never);

    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({
        outboxEventId: 'row1',
        endpointId: 'ep-a',
        tenantId: 't1',
        event: 'DEAL_CREATED',
        idempotencyKey: 'row1::ep-a',
      }),
      expect.objectContaining({ jobId: 'row1::ep-a' }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({ endpointId: 'ep-b', idempotencyKey: 'row1::ep-b' }),
      expect.objectContaining({ jobId: 'row1::ep-b' }),
    );
    expect(metrics.recordOutboxProcessed).toHaveBeenCalledWith('published', 2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row1' },
      data: expect.objectContaining({ status: OutboxEventStatus.PUBLISHED }),
    }));
  });

  it('handles enqueue failure by bumping attempts + recording failed', async () => {
    const row = { id: 'row1', tenantId: 't1', eventType: 'DEAL_CREATED', payload: {}, createdAt: new Date() };
    const findMany = vi.fn().mockResolvedValue([row]);
    const endpointFindMany = vi.fn().mockResolvedValue([{ id: 'ep-a' }]);
    const update = vi.fn().mockResolvedValue({ attempts: 1 });
    const { prisma } = buildPrisma({ findMany, endpointFindMany, update });
    const queueAdd = vi.fn().mockRejectedValueOnce(new Error('redis offline'));
    const metrics = buildMetrics();
    const poller = makePoller({ prisma, queueAdd, metrics });

    await poller.process(makeJob() as never);

    expect(metrics.recordOutboxProcessed).toHaveBeenCalledWith('failed');
    // First call increments attempts + sets lastError; not transitioned to FAILED yet.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row1' },
      data: expect.objectContaining({
        attempts: { increment: 1 },
        lastError: 'redis offline',
      }),
    }));
  });

  it('transitions a row to FAILED after MAX_ATTEMPTS', async () => {
    const row = { id: 'row1', tenantId: 't1', eventType: 'DEAL_CREATED', payload: {}, createdAt: new Date() };
    const findMany = vi.fn().mockResolvedValue([row]);
    const endpointFindMany = vi.fn().mockResolvedValue([{ id: 'ep-a' }]);
    // First update returns attempts >= MAX so second update fires.
    const update = vi
      .fn()
      .mockResolvedValueOnce({ attempts: OUTBOX_MAX_ATTEMPTS })
      .mockResolvedValueOnce({});
    const { prisma } = buildPrisma({ findMany, endpointFindMany, update });
    const queueAdd = vi.fn().mockRejectedValueOnce(new Error('persistent failure'));
    const poller = makePoller({ prisma, queueAdd });

    await poller.process(makeJob() as never);

    // Two updates: bump attempts then mark FAILED.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: { id: 'row1' },
      data: expect.objectContaining({ status: OutboxEventStatus.FAILED }),
    }));
  });

  // Phase 1.1 HIGH-3 regression guard: filterActiveTenants drops candidates
  // belonging to inactive/suspended tenants. The dropped rows stay PENDING
  // (held back, NOT marked FAILED) so a later un-suspend can ship them.
  it('regression HIGH-3: drops events for inactive tenants from the batch (no enqueue, no status flip)', async () => {
    const rowA = {
      id: 'r-A',
      tenantId: 't-active',
      eventType: 'DEAL_CREATED',
      payload: { id: 'd1' },
      createdAt: new Date(),
    };
    const rowB = {
      id: 'r-B',
      tenantId: 't-suspended',
      eventType: 'DEAL_CREATED',
      payload: { id: 'd2' },
      createdAt: new Date(),
    };
    const findMany = vi.fn().mockResolvedValue([rowA, rowB]);
    // Only the active tenant comes back from the active-set query.
    const tenantFindMany = vi.fn().mockResolvedValue([{ id: 't-active' }]);
    const endpointFindMany = vi.fn().mockResolvedValue([{ id: 'ep-a' }]);
    const update = vi.fn().mockResolvedValue({ attempts: 1 });
    const { prisma } = buildPrisma({ findMany, tenantFindMany, endpointFindMany, update });
    const queueAdd = vi.fn().mockResolvedValue({});
    const poller = makePoller({ prisma, queueAdd });

    await poller.process(makeJob() as never);

    // Only the active-tenant row got enqueued.
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const enqueuedJob = queueAdd.mock.calls[0]![1] as { tenantId: string };
    expect(enqueuedJob.tenantId).toBe('t-active');
    // Active-tenant row marked PUBLISHED. Suspended-tenant row UNTOUCHED
    // (stays PENDING for next tick — held back, not lost).
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { id: 'r-A' },
      data: expect.objectContaining({ status: OutboxEventStatus.PUBLISHED }),
    }));
  });
});
