import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { CampaignsService } from './campaigns.service';

interface TxMock {
  campaign: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  // Phase 1.1 CRIT-1 partial: sendTest now validates recipient against
  // tenant's Users (must be verified + active). Mocked here so the existing
  // happy-path tests still pass without setting up a real user lookup.
  user: { findFirst: ReturnType<typeof vi.fn> };
}

function build(): {
  svc: CampaignsService;
  prisma: {
    runWithTenant: ReturnType<typeof vi.fn>;
    campaign: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  tx: TxMock;
  redis: { incr: ReturnType<typeof vi.fn>; ttl: ReturnType<typeof vi.fn> };
  audit: { log: ReturnType<typeof vi.fn> };
  email: { sendTransactional: ReturnType<typeof vi.fn> };
  recipients: { enqueue: ReturnType<typeof vi.fn> };
  queue: { getJob: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
  outbox: { publish: ReturnType<typeof vi.fn> };
} {
  const tx: TxMock = {
    campaign: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      // Phase 1.1 BLOCKER-3: launch() now wraps update in runWithTenant —
      // configure the tx.campaign.update mock to mirror the legacy
      // prisma.campaign.update return so the existing tests still see the
      // expected value.
      update: vi.fn(),
    },
    user: {
      // Default to "verified user found" so existing happy-path sendTest
      // tests don't have to opt in to the recipient validation. Specific
      // negative tests override to return null.
      findFirst: vi.fn().mockResolvedValue({ id: 'u-A' }),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: TxMock) => unknown) => fn(tx)),
    // Public-path methods on the global client (used by launch's pre-read).
    campaign: { findFirst: vi.fn(), update: vi.fn() },
  };
  const redis = { incr: vi.fn(), ttl: vi.fn().mockResolvedValue(1) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const email = { sendTransactional: vi.fn().mockResolvedValue({ id: 'msg-1' }) };
  const recipients = { enqueue: vi.fn().mockResolvedValue({ recipientCount: 10 }) };
  const queue = {
    getJob: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };
  // Phase 1.1 BLOCKER-3: outbox is now injected (optional ctor arg).
  const outbox = { publish: vi.fn().mockResolvedValue('outbox-id-1') };
  const svc = new CampaignsService(
    prisma as unknown as ConstructorParameters<typeof CampaignsService>[0],
    redis as unknown as ConstructorParameters<typeof CampaignsService>[1],
    audit as unknown as ConstructorParameters<typeof CampaignsService>[2],
    email as unknown as ConstructorParameters<typeof CampaignsService>[3],
    recipients as unknown as ConstructorParameters<typeof CampaignsService>[4],
    queue as unknown as ConstructorParameters<typeof CampaignsService>[5],
    outbox as unknown as ConstructorParameters<typeof CampaignsService>[6],
  );
  return { svc, prisma, tx, redis, audit, email, recipients, queue, outbox };
}

describe('CampaignsService.launch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFoundException when campaign missing', async () => {
    const h = build();
    h.prisma.campaign.findFirst.mockResolvedValue(null);
    await expect(h.svc.launch('c-1', 'tenant-1')).rejects.toThrow(NotFoundException);
    expect(h.prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('no-ops and returns existing when already ACTIVE', async () => {
    const h = build();
    const existing = { id: 'c-1', status: 'ACTIVE', startDate: new Date('2026-01-01') };
    h.prisma.campaign.findFirst.mockResolvedValue(existing);
    const result = await h.svc.launch('c-1', 'tenant-1');
    expect(result).toBe(existing);
    expect(h.prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('returns COMPLETED campaign unchanged', async () => {
    const h = build();
    const existing = { id: 'c-1', status: 'COMPLETED', startDate: new Date('2026-01-01') };
    h.prisma.campaign.findFirst.mockResolvedValue(existing);
    const result = await h.svc.launch('c-1', 'tenant-1');
    expect(result).toBe(existing);
    expect(h.prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('transitions DRAFT → ACTIVE, back-fills startDate when null', async () => {
    const h = build();
    const existing = { id: 'c-1', status: 'DRAFT', startDate: null, name: 'X', channel: 'EMAIL' };
    const launched = { id: 'c-1', status: 'ACTIVE', startDate: new Date(), name: 'X', channel: 'EMAIL' };
    h.prisma.campaign.findFirst.mockResolvedValue(existing);
    // Phase 1.1 BLOCKER-3: launch now runs the update inside runWithTenant +
    // emits CAMPAIGN_SENT to outbox in the same tx. Mock the tx-side update.
    h.tx.campaign.update.mockResolvedValue(launched);
    const result = await h.svc.launch('c-1', 'tenant-1');
    expect(result).toBe(launched);
    const arg = h.tx.campaign.update.mock.calls[0][0];
    expect(arg.data.status).toBe('ACTIVE');
    expect(arg.data.startDate).toBeInstanceOf(Date);
    // CAMPAIGN_SENT emitted in same tx
    expect(h.outbox.publish).toHaveBeenCalledWith(
      'CAMPAIGN_SENT',
      expect.objectContaining({ campaignId: 'c-1' }),
      expect.objectContaining({ tx: expect.anything(), aggregateType: 'Campaign' }),
    );
  });

  it('transitions PAUSED → ACTIVE, preserves existing startDate', async () => {
    const h = build();
    const preset = new Date('2026-01-15');
    const existing = { id: 'c-1', status: 'PAUSED', startDate: preset, name: 'X', channel: 'EMAIL' };
    h.prisma.campaign.findFirst.mockResolvedValue(existing);
    h.tx.campaign.update.mockResolvedValue({ ...existing, status: 'ACTIVE' });
    await h.svc.launch('c-1', 'tenant-1');
    expect(h.tx.campaign.update.mock.calls[0][0].data.startDate).toBe(preset);
  });
});

describe('CampaignsService.create + audit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes a campaign.created audit event with name + channel', async () => {
    const h = build();
    h.tx.campaign.create.mockResolvedValue({ id: 'c-99', name: 'Spring', channel: 'EMAIL' });
    await h.svc.create({
      name: 'Spring',
      channel: 'EMAIL',
      currency: 'RON',
      targetCount: 0,
    } as never);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'campaign.created',
      subjectType: 'Campaign',
      subjectId: 'c-99',
      metadata: expect.objectContaining({ name: 'Spring', channel: 'EMAIL' }),
    }));
  });
});

describe('CampaignsService.sendTest', () => {
  beforeEach(() => vi.clearAllMocks());

  const ready = {
    id: 'c-1',
    name: 'Spring',
    subject: 'Hello',
    fromAddress: 'send@x.ro',
    templateJson: { version: 1, blocks: [{ id: 'b1', type: 'paragraph', text: 'hi {{contact.firstName}}' }] },
    status: 'DRAFT',
  };

  it('throws CAMPAIGN_INCOMPLETE when template missing', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ ...ready, templateJson: null });
    await expect(h.svc.sendTest('c-1', { email: 't@x.ro' } as never))
      .rejects.toThrow(BadRequestException);
    expect(h.email.sendTransactional).not.toHaveBeenCalled();
  });

  it('throws TOO_MANY_REQUESTS when redis counter > 5', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(ready);
    h.redis.incr.mockResolvedValueOnce(6);
    // Phase 1.1 I-4: rate-limit now throws HttpException(429), not 400.
    await expect(h.svc.sendTest('c-1', { email: 't@x.ro' } as never))
      .rejects.toMatchObject({ status: 429 });
    expect(h.email.sendTransactional).not.toHaveBeenCalled();
  });

  // Phase 1.1 CRIT-1 partial: send-test now rejects recipients that are not
  // verified active users of the calling tenant.
  it('rejects SEND_TEST_RECIPIENT_NOT_USER when recipient is not a verified user', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(ready);
    h.tx.user.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.sendTest('c-1', { email: 'phish@evil.ro' } as never))
      .rejects.toThrow(BadRequestException);
    expect(h.email.sendTransactional).not.toHaveBeenCalled();
  });

  // Phase 1.1 CRIT-1 partial: global per-user budget across campaigns.
  it('throws TOO_MANY_REQUESTS when global per-user counter exceeds 10/h', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(ready);
    // Per-campaign counter passes (1), global one trips (11).
    h.redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(11);
    await expect(h.svc.sendTest('c-1', { email: 't@x.ro' } as never))
      .rejects.toMatchObject({ status: 429 });
    expect(h.email.sendTransactional).not.toHaveBeenCalled();
  });

  it('sends preview with [TEST] subject prefix on success', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(ready);
    // 1st incr = per-campaign, 2nd = global. Both well under cap.
    h.redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const out = await h.svc.sendTest('c-1', { email: 't@x.ro' } as never);
    expect(out.messageId).toBe('msg-1');
    const arg = h.email.sendTransactional.mock.calls[0][1];
    expect(arg.subject).toBe('[TEST] Hello');
    expect(arg.to).toBe('t@x.ro');
    expect(arg.bodyHtml).toContain('[firstName]');
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'campaign.test_sent',
    }));
  });
});

describe('CampaignsService.schedule', () => {
  beforeEach(() => vi.clearAllMocks());

  const ready = {
    id: 'c-1',
    name: 'Spring',
    subject: 'Hi',
    fromAddress: 'send@x.ro',
    templateJson: { version: 1, blocks: [] },
    recipientFilter: { contactIds: ['k-1'] },
    status: 'DRAFT',
    scheduledAt: null,
  };

  it('throws CAMPAIGN_INCOMPLETE when recipientFilter missing', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ ...ready, recipientFilter: null });
    await expect(h.svc.schedule('c-1', { scheduledAt: new Date(Date.now() + 60_000) } as never))
      .rejects.toThrow(BadRequestException);
  });

  it('refuses to schedule a COMPLETED campaign', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ ...ready, status: 'COMPLETED' });
    await expect(h.svc.schedule('c-1', { scheduledAt: new Date(Date.now() + 60_000) } as never))
      .rejects.toThrow(BadRequestException);
  });

  it('materialises recipients, enqueues delayed job, persists SCHEDULED', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(ready);
    h.tx.campaign.update.mockResolvedValue({ ...ready, status: 'SCHEDULED', recipientCount: 10 });
    const future = new Date(Date.now() + 120_000);
    await h.svc.schedule('c-1', { scheduledAt: future } as never);
    expect(h.recipients.enqueue).toHaveBeenCalledWith('c-1', ready.recipientFilter);
    expect(h.queue.add).toHaveBeenCalledWith(
      'dispatch',
      { campaignId: 'c-1', tenantId: 'tenant-1' },
      expect.objectContaining({ jobId: 'campaign-c-1', delay: expect.any(Number) }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'campaign.scheduled',
    }));
  });

  it('removes any prior delayed job before re-scheduling (idempotent)', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(ready);
    h.tx.campaign.update.mockResolvedValue({ ...ready, status: 'SCHEDULED' });
    const remove = vi.fn();
    h.queue.getJob.mockResolvedValueOnce({ remove });
    await h.svc.schedule('c-1', { scheduledAt: new Date(Date.now() + 60_000) } as never);
    expect(remove).toHaveBeenCalled();
  });
});

describe('CampaignsService.cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to cancel a COMPLETED campaign', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'COMPLETED' });
    await expect(h.svc.cancel('c-1')).rejects.toThrow(BadRequestException);
  });

  it('returns the campaign unchanged when already CANCELLED', async () => {
    const h = build();
    const existing = { id: 'c-1', status: 'CANCELLED' };
    h.tx.campaign.findFirst.mockResolvedValue(existing);
    const out = await h.svc.cancel('c-1');
    expect(out).toBe(existing);
    expect(h.queue.getJob).not.toHaveBeenCalled();
  });

  it('removes the delayed job and writes audit event', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'SCHEDULED' });
    h.tx.campaign.update.mockResolvedValue({ id: 'c-1', status: 'CANCELLED' });
    const remove = vi.fn();
    h.queue.getJob.mockResolvedValueOnce({ remove });
    await h.svc.cancel('c-1');
    expect(remove).toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'campaign.cancelled',
    }));
  });
});

describe('CampaignsService.pause + resume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pause: refuses CANCELLED', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'CANCELLED' });
    await expect(h.svc.pause('c-1')).rejects.toThrow(BadRequestException);
  });

  it('pause: removes delayed job + flips status', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'SCHEDULED' });
    h.tx.campaign.update.mockResolvedValue({ id: 'c-1', status: 'PAUSED' });
    const remove = vi.fn();
    h.queue.getJob.mockResolvedValueOnce({ remove });
    await h.svc.pause('c-1');
    expect(remove).toHaveBeenCalled();
  });

  it('resume: refuses non-PAUSED', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'DRAFT' });
    await expect(h.svc.resume('c-1')).rejects.toThrow(BadRequestException);
  });

  it('resume: re-enqueues with delay when scheduledAt in future → SCHEDULED', async () => {
    const h = build();
    const future = new Date(Date.now() + 60_000);
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'PAUSED', scheduledAt: future });
    h.tx.campaign.update.mockResolvedValue({ id: 'c-1', status: 'SCHEDULED' });
    await h.svc.resume('c-1');
    expect(h.queue.add).toHaveBeenCalledWith(
      'dispatch',
      expect.any(Object),
      expect.objectContaining({ jobId: 'campaign-c-1', delay: expect.any(Number) }),
    );
    expect(h.tx.campaign.update.mock.calls[0][0].data.status).toBe('SCHEDULED');
  });

  it('resume: enqueues immediately when no scheduledAt → ACTIVE', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1', status: 'PAUSED', scheduledAt: null });
    h.tx.campaign.update.mockResolvedValue({ id: 'c-1', status: 'ACTIVE' });
    await h.svc.resume('c-1');
    const opts = h.queue.add.mock.calls[0][2];
    expect(opts.delay).toBeUndefined();
    expect(h.tx.campaign.update.mock.calls[0][0].data.status).toBe('ACTIVE');
  });
});

describe('CampaignsService.getStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns denormalised counters from the campaign row', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({
      id: 'c-1',
      recipientCount: 100,
      sentSuccessCount: 95,
      sentFailureCount: 5,
      openCount: 60,
      uniqueOpenCount: 55,
      clickCount: 30,
      uniqueClickCount: 28,
      bounceCount: 3,
      unsubscribeCount: 2,
      spamReportCount: 0,
      status: 'COMPLETED',
      scheduledAt: null,
      sentAt: new Date('2026-05-01'),
    });
    const out = await h.svc.getStats('c-1');
    expect(out.recipientCount).toBe(100);
    expect(out.openCount).toBe(60);
    expect(out.status).toBe('COMPLETED');
  });
});
