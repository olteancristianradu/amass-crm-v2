import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('../../common/crypto/encryption', () => ({
  encrypt: vi.fn((s: string) => `ENC(${s})`),
  decrypt: vi.fn((s: string) => s.replace(/^ENC\(|\)$/g, '')),
}));

import { WhatsappService } from './whatsapp.service';

function build() {
  const tx = {
    whatsappAccount: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    whatsappMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    whatsappMessage: { findUnique: vi.fn(), updateMany: vi.fn() },
  } as unknown as ConstructorParameters<typeof WhatsappService>[0];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof WhatsappService>[1];
  const svc = new WhatsappService(prisma, activities);
  return { svc, prisma, tx, activities };
}

describe('WhatsappService.createAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encrypts the access token at rest', async () => {
    const h = build();
    h.tx.whatsappAccount.create.mockResolvedValueOnce({ id: 'wa-1' });
    await h.svc.createAccount({
      phoneNumberId: 'pn-1',
      displayPhoneNumber: '+40712345678',
      accessToken: 'plain-token',
      webhookVerifyToken: 'wh-token',
    } as never);
    const data = h.tx.whatsappAccount.create.mock.calls[0][0].data;
    expect(data.accessTokenEnc).toBe('ENC(plain-token)');
    // Verify token stays plaintext (it's compared in equality check, not encrypted-at-rest design).
    expect(data.webhookVerifyToken).toBe('wh-token');
  });
});

describe('WhatsappService.send', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when no active account exists', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce(null);
    await expect(
      h.svc.send({
        toNumber: '+40712',
        body: 'Hi',
        subjectType: 'CONTACT',
        subjectId: 'c-1',
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects empty body', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      phoneNumberId: 'pn-1',
      displayPhoneNumber: '+40700000000',
      accessTokenEnc: 'ENC(t)',
    });
    await expect(
      h.svc.send({
        toNumber: '+40712',
        body: '',
        subjectType: 'CONTACT',
        subjectId: 'c-1',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('strips non-digits from toNumber and persists OUTBOUND row + activity', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      phoneNumberId: 'pn-1',
      displayPhoneNumber: '+40700000000',
      accessTokenEnc: 'ENC(t)',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.XXX' }] }),
    } as Response);
    h.tx.whatsappMessage.create.mockResolvedValueOnce({ id: 'm-1' });
    await h.svc.send({
      toNumber: '+40 (712) 345-678',
      body: 'Salut',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    } as never);
    const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(fetchBody.to).toBe('40712345678'); // digits only
    expect(fetchBody.text.body).toBe('Salut');
    const data = h.tx.whatsappMessage.create.mock.calls[0][0].data;
    expect(data.direction).toBe('OUTBOUND');
    expect(data.externalId).toBe('wamid.XXX');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.sent' }),
    );
    fetchSpy.mockRestore();
  });

  it('propagates Meta API error responses', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      phoneNumberId: 'pn-1',
      displayPhoneNumber: '+40700000000',
      accessTokenEnc: 'ENC(t)',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid' }),
    } as Response);
    await expect(
      h.svc.send({
        toNumber: '+40712',
        body: 'Hi',
        subjectType: 'CONTACT',
        subjectId: 'c-1',
      } as never),
    ).rejects.toThrow(BadRequestException);
    fetchSpy.mockRestore();
  });
});

describe('WhatsappService.verifyWebhook', () => {
  // M-aud-M1: signature changed — service now reads the expected token
  // from the DB by tenantId rather than receiving it as a parameter.
  it('refuses a wrong verify token', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({ webhookVerifyToken: 'expected' });
    await expect(h.svc.verifyWebhook('tenant-1', 'wrong', 'CHALLENGE'))
      .rejects.toThrow(UnauthorizedException);
  });

  it('echoes the challenge when token matches', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({ webhookVerifyToken: 'expected' });
    await expect(h.svc.verifyWebhook('tenant-1', 'expected', 'CHAL-9'))
      .resolves.toBe('CHAL-9');
  });

  it('refuses when no active WhatsApp account exists for the tenant', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.verifyWebhook('tenant-1', 'anything', 'CHAL'))
      .rejects.toThrow(UnauthorizedException);
  });
});

describe('WhatsappService.handleWebhook', () => {
  beforeEach(() => vi.clearAllMocks());

  function signedSig(secret: string, body: unknown): string {
    return `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;
  }

  it('refuses a tampered signature (HMAC mismatch)', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      displayPhoneNumber: '+40700000000',
      webhookVerifyToken: 'sec',
    });
    await expect(h.svc.handleWebhook('tenant-1', { entry: [] }, 'sha256=00')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns silently when tenant has no active account (signature not even checked)', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.handleWebhook('tenant-1', {}, 'sha256=anything')).resolves.toBeUndefined();
  });

  it('persists INBOUND messages and skips already-stored externalIds (idempotent)', async () => {
    const h = build();
    h.tx.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      displayPhoneNumber: '+40700000000',
      webhookVerifyToken: 'sec',
    });
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.A', from: '40712', text: { body: 'hi' }, timestamp: '1714200000' },
                  { id: 'wamid.B', from: '40712', text: { body: 'twice' }, timestamp: '1714200001' },
                ],
              },
            },
          ],
        },
      ],
    };
    vi.mocked(h.prisma.whatsappMessage.findUnique)
      .mockResolvedValueOnce(null) // wamid.A is new
      .mockResolvedValueOnce({ id: 'pre-existing' } as never); // wamid.B is duplicate
    h.tx.whatsappMessage.create.mockResolvedValueOnce({});
    await h.svc.handleWebhook('tenant-1', body, signedSig('sec', body));
    expect(h.tx.whatsappMessage.create).toHaveBeenCalledTimes(1);
    const data = h.tx.whatsappMessage.create.mock.calls[0][0].data;
    expect(data.externalId).toBe('wamid.A');
    expect(data.direction).toBe('INBOUND');
  });
});

describe('WhatsappService.updateStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps "delivered" → DELIVERED + stamps deliveredAt', async () => {
    const h = build();
    vi.mocked(h.prisma.whatsappMessage.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    await h.svc.updateStatus('wamid.A', 'delivered');
    const args = vi.mocked(h.prisma.whatsappMessage.updateMany).mock.calls[0][0];
    expect(args.data.status).toBe('DELIVERED');
    expect(args.data.deliveredAt).toBeInstanceOf(Date);
    expect('readAt' in args.data).toBe(false);
  });

  it('maps "read" → READ + stamps readAt', async () => {
    const h = build();
    vi.mocked(h.prisma.whatsappMessage.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    await h.svc.updateStatus('wamid.A', 'read');
    const args = vi.mocked(h.prisma.whatsappMessage.updateMany).mock.calls[0][0];
    expect(args.data.status).toBe('READ');
    expect(args.data.readAt).toBeInstanceOf(Date);
  });

  it('ignores unknown statuses (no-op, no DB write)', async () => {
    const h = build();
    await h.svc.updateStatus('wamid.A', 'something-weird');
    expect(vi.mocked(h.prisma.whatsappMessage.updateMany)).not.toHaveBeenCalled();
  });
});
