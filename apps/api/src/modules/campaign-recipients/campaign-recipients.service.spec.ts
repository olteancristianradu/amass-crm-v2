import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));
vi.mock('../../config/env', () => ({
  loadEnv: () => ({
    CAMPAIGN_HMAC_KEY: 'a'.repeat(64),
    JWT_SECRET: 'jwt-fallback-secret-aaaaaaaaaaaaaaaaa',
  }),
}));

import { CampaignRecipientsService } from './campaign-recipients.service';

interface TxMock {
  campaign: { findFirst: ReturnType<typeof vi.fn> };
  campaignRecipient: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  contact: { findMany: ReturnType<typeof vi.fn> };
  lead: { findMany: ReturnType<typeof vi.fn> };
  client: { findMany: ReturnType<typeof vi.fn> };
}

function build(): {
  svc: CampaignRecipientsService;
  prisma: {
    runWithTenant: ReturnType<typeof vi.fn>;
    campaignRecipient: { findUnique: ReturnType<typeof vi.fn> };
    campaign: { update: ReturnType<typeof vi.fn> };
  };
  tx: TxMock;
  segments: { preview: ReturnType<typeof vi.fn> };
} {
  const tx: TxMock = {
    campaign: { findFirst: vi.fn() },
    campaignRecipient: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    contact: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: TxMock) => unknown) => fn(tx)),
    campaignRecipient: { findUnique: vi.fn() },
    campaign: { update: vi.fn() },
  };
  // Bind tx.campaign.update so the recordEvent path can also reach it via tx
  (tx as unknown as Record<string, unknown>).campaign = {
    ...tx.campaign,
    update: prisma.campaign.update,
  };
  const segments = { preview: vi.fn() };
  const svc = new CampaignRecipientsService(
    prisma as unknown as ConstructorParameters<typeof CampaignRecipientsService>[0],
    segments as unknown as ConstructorParameters<typeof CampaignRecipientsService>[1],
  );
  return { svc, prisma, tx, segments };
}

describe('CampaignRecipientsService — HMAC tracking token', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generateTrackingToken produces a base64url string of expected length', () => {
    const { svc } = build();
    const token = svc.generateTrackingToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 raw bytes → 43 base64 chars unpadded
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token.length).toBeLessThanOrEqual(48);
  });

  it('verifyTrackingToken returns true for a freshly generated token', () => {
    const { svc } = build();
    const token = svc.generateTrackingToken();
    expect(svc.verifyTrackingToken(token)).toBe(true);
  });

  it('verifyTrackingToken rejects tampered tokens', () => {
    const { svc } = build();
    const token = svc.generateTrackingToken();
    // Flip last char to a different base64url char (always valid charset)
    const lastChar = token.slice(-1);
    const swap = lastChar === 'A' ? 'B' : 'A';
    const tampered = token.slice(0, -1) + swap;
    expect(svc.verifyTrackingToken(tampered)).toBe(false);
  });

  it('verifyTrackingToken rejects tokens with invalid charset', () => {
    const { svc } = build();
    expect(svc.verifyTrackingToken('not!a!token')).toBe(false);
  });

  it('verifyTrackingToken rejects tokens of wrong length', () => {
    const { svc } = build();
    expect(svc.verifyTrackingToken('abc')).toBe(false);
  });
});

describe('CampaignRecipientsService.enqueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when campaign missing', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue(null);
    await expect(
      h.svc.enqueue('c-1', { contactIds: ['x-1'] } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws EMPTY_AUDIENCE when filter resolves to zero rows', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
    h.tx.contact.findMany.mockResolvedValue([]);
    await expect(
      h.svc.enqueue('c-1', { contactIds: ['ghost'] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('drops recipients without an email', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
    h.tx.contact.findMany.mockResolvedValue([
      { id: 'k-1', email: 'a@x.ro' },
      { id: 'k-2', email: null },
      { id: 'k-3', email: 'c@x.ro' },
    ]);
    h.tx.campaignRecipient.findMany.mockResolvedValue([]);
    h.tx.campaignRecipient.createMany.mockResolvedValue({ count: 2 });
    h.tx.campaignRecipient.count.mockResolvedValue(2);

    const out = await h.svc.enqueue('c-1', { contactIds: ['k-1', 'k-2', 'k-3'] } as never);
    expect(out.recipientCount).toBe(2);
    const inserted = h.tx.campaignRecipient.createMany.mock.calls[0][0].data;
    expect(inserted).toHaveLength(2);
    expect(inserted.every((r: { email: string }) => r.email)).toBe(true);
  });

  it('de-duplicates the same subject across branches', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
    h.tx.contact.findMany.mockResolvedValue([{ id: 'k-1', email: 'a@x.ro' }]);
    h.segments.preview.mockResolvedValue([{ id: 'k-1', email: 'a@x.ro' }]);
    h.tx.campaignRecipient.findMany.mockResolvedValue([]);
    h.tx.campaignRecipient.createMany.mockResolvedValue({ count: 1 });
    h.tx.campaignRecipient.count.mockResolvedValue(1);

    await h.svc.enqueue('c-1', { contactIds: ['k-1'], segmentId: 'seg-1' } as never);
    const inserted = h.tx.campaignRecipient.createMany.mock.calls[0][0].data;
    expect(inserted).toHaveLength(1);
  });

  it('skips subjects already on the campaign (idempotent re-schedule)', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
    h.tx.contact.findMany.mockResolvedValue([
      { id: 'k-1', email: 'a@x.ro' },
      { id: 'k-2', email: 'b@x.ro' },
    ]);
    h.tx.campaignRecipient.findMany.mockResolvedValue([
      { subjectType: 'CONTACT', subjectId: 'k-1' },
    ]);
    h.tx.campaignRecipient.createMany.mockResolvedValue({ count: 1 });
    h.tx.campaignRecipient.count.mockResolvedValue(2);

    const out = await h.svc.enqueue('c-1', { contactIds: ['k-1', 'k-2'] } as never);
    expect(out.recipientCount).toBe(2);
    const inserted = h.tx.campaignRecipient.createMany.mock.calls[0][0].data;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].subjectId).toBe('k-2');
  });

  it('returns existing count without inserting when all subjects are already present', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
    h.tx.contact.findMany.mockResolvedValue([{ id: 'k-1', email: 'a@x.ro' }]);
    h.tx.campaignRecipient.findMany.mockResolvedValue([
      { subjectType: 'CONTACT', subjectId: 'k-1' },
    ]);

    const out = await h.svc.enqueue('c-1', { contactIds: ['k-1'] } as never);
    expect(out.recipientCount).toBe(1);
    expect(h.tx.campaignRecipient.createMany).not.toHaveBeenCalled();
  });

  it('persists trackingToken on each new row', async () => {
    const h = build();
    h.tx.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
    h.tx.contact.findMany.mockResolvedValue([{ id: 'k-1', email: 'a@x.ro' }]);
    h.tx.campaignRecipient.findMany.mockResolvedValue([]);
    h.tx.campaignRecipient.createMany.mockResolvedValue({ count: 1 });
    h.tx.campaignRecipient.count.mockResolvedValue(1);

    await h.svc.enqueue('c-1', { contactIds: ['k-1'] } as never);
    const row = h.tx.campaignRecipient.createMany.mock.calls[0][0].data[0];
    expect(row.trackingToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(row.trackingToken.length).toBeGreaterThanOrEqual(40);
    expect(h.svc.verifyTrackingToken(row.trackingToken)).toBe(true);
  });
});

describe('CampaignRecipientsService.getByToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null on signature mismatch without touching the DB', async () => {
    const h = build();
    const out = await h.svc.getByToken('garbage-token-xxxxxxxxxxxx');
    expect(out).toBeNull();
    expect(h.prisma.campaignRecipient.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for invalid charset without touching the DB', async () => {
    const h = build();
    const out = await h.svc.getByToken('bad!chars!here');
    expect(out).toBeNull();
    expect(h.prisma.campaignRecipient.findUnique).not.toHaveBeenCalled();
  });

  it('looks up via the unscoped client when signature is valid', async () => {
    const h = build();
    const token = h.svc.generateTrackingToken();
    h.prisma.campaignRecipient.findUnique.mockResolvedValueOnce({ id: 'r-1', trackingToken: token });
    const out = await h.svc.getByToken(token);
    expect(out).toEqual({ id: 'r-1', trackingToken: token });
    expect(h.prisma.campaignRecipient.findUnique).toHaveBeenCalledWith({
      where: { trackingToken: token },
    });
  });
});

describe('CampaignRecipientsService.recordEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs and returns when recipient is missing (no crash)', async () => {
    const h = build();
    h.prisma.campaignRecipient.findUnique.mockResolvedValueOnce(null);
    await expect(h.svc.recordEvent('missing', 'open')).resolves.toBeUndefined();
  });

  it('bumps openCount + lastOpenAt + campaign aggregate on open', async () => {
    const h = build();
    h.prisma.campaignRecipient.findUnique.mockResolvedValueOnce({
      id: 'r-1', tenantId: 't-1', campaignId: 'c-1',
    });
    await h.svc.recordEvent('r-1', 'open');
    expect(h.tx.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: expect.objectContaining({
        openCount: { increment: 1 },
        lastOpenAt: expect.any(Date),
      }),
    });
    expect(h.prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { openCount: { increment: 1 } },
    });
  });

  it('bumps clickCount + lastClickAt + campaign aggregate on click', async () => {
    const h = build();
    h.prisma.campaignRecipient.findUnique.mockResolvedValueOnce({
      id: 'r-1', tenantId: 't-1', campaignId: 'c-1',
    });
    await h.svc.recordEvent('r-1', 'click');
    expect(h.tx.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: expect.objectContaining({
        clickCount: { increment: 1 },
        lastClickAt: expect.any(Date),
      }),
    });
    expect(h.prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { clickCount: { increment: 1 } },
    });
  });
});

describe('CampaignRecipientsService.listByCampaign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters by status when provided + scopes by tenantId', async () => {
    const h = build();
    h.tx.campaignRecipient.findMany.mockResolvedValue([{ id: 'r-1' }]);
    await h.svc.listByCampaign('c-1', { status: 'SENT', limit: 50 } as never);
    const arg = h.tx.campaignRecipient.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      campaignId: 'c-1',
      tenantId: 'tenant-1',
      status: 'SENT',
    });
  });

  it('returns cursor page shape', async () => {
    const h = build();
    h.tx.campaignRecipient.findMany.mockResolvedValue([{ id: 'r-1' }, { id: 'r-2' }]);
    const out = await h.svc.listByCampaign('c-1', { limit: 50 } as never);
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('nextCursor');
  });
});
