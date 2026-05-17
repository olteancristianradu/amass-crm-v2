import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxService } from './outbox.service';

vi.mock('../prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

type CreateMock = ReturnType<typeof vi.fn>;

function makeTx(create: CreateMock) {
  return { outboxEvent: { create } } as unknown as Parameters<OutboxService['publish']>[2]['tx'];
}

describe('OutboxService', () => {
  let svc: OutboxService;

  beforeEach(() => {
    svc = new OutboxService();
  });

  it('throws when called without a transaction', async () => {
    await expect(
      svc.publish('DEAL_CREATED', { id: 'd1' }, { tx: undefined as never }),
    ).rejects.toThrow(/tx is required/);
  });

  it('inserts an outbox row with the resolved tenantId from ALS', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'outbox-row-1' });
    const tx = makeTx(create);

    const id = await svc.publish('DEAL_CREATED', { id: 'd1', amount: 42 }, {
      aggregateType: 'Deal',
      aggregateId: 'd1',
      tx,
    });

    expect(id).toBe('outbox-row-1');
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        eventType: 'DEAL_CREATED',
        aggregateType: 'Deal',
        aggregateId: 'd1',
        payload: { id: 'd1', amount: 42 },
      },
      select: { id: true },
    });
  });

  it('handles missing aggregateType/aggregateId by storing null', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'outbox-row-2' });
    const tx = makeTx(create);

    await svc.publish('CAMPAIGN_SENT', { campaignId: 'c1' }, { tx });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aggregateType: null,
        aggregateId: null,
      }),
    }));
  });

  it('coerces an enum-style string eventType to a string for the DB column', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'x' });
    await svc.publish('EMAIL_OPENED', {}, { tx: makeTx(create) });
    expect(create.mock.calls[0][0].data.eventType).toBe('EMAIL_OPENED');
  });

  it('propagates DB errors from the create call', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(
      svc.publish('DEAL_CREATED', {}, { tx: makeTx(create) }),
    ).rejects.toThrow(/db down/);
  });
});
