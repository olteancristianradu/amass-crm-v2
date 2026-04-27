import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));
vi.mock('../../common/crypto/encryption', () => ({
  encrypt: vi.fn((s: string) => `ENC(${s})`),
  decrypt: vi.fn((s: string) => s.replace(/^ENC\(|\)$/g, '')),
}));

import { EmailService } from './email.service';

function build() {
  const tx = {
    emailAccount: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    emailMessage: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof EmailService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof EmailService>[1];
  const subjects = { assertExists: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof EmailService>[2];
  const tracking = {
    injectTracking: vi.fn((_id: string, body: string) => body),
  } as unknown as ConstructorParameters<typeof EmailService>[3];
  const emailQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  } as unknown as ConstructorParameters<typeof EmailService>[4];
  const svc = new EmailService(prisma, audit, subjects, tracking, emailQueue);
  return { svc, prisma, tx, audit, subjects, tracking, emailQueue };
}

describe('EmailService — auth gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws AUTH_REQUIRED when tenant ctx has no userId', async () => {
    const h = build();
    const { requireTenantContext } = await import('../../infra/prisma/tenant-context');
    vi.mocked(requireTenantContext).mockReturnValueOnce({ tenantId: 'tenant-1' } as never);
    await expect(h.svc.listAccounts()).rejects.toThrow(BadRequestException);
  });
});

describe('EmailService.createAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encrypts the SMTP password before persisting + strips it from response', async () => {
    const h = build();
    h.tx.emailAccount.create.mockResolvedValueOnce({
      id: 'a-1',
      label: 'Gmail',
      fromEmail: 'a@x.ro',
      smtpPassEnc: 'ENC(secret)',
    });
    const out = await h.svc.createAccount({
      label: 'Gmail',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'a@x.ro',
      smtpPass: 'secret',
      fromName: 'Andrei',
      fromEmail: 'a@x.ro',
      isDefault: false,
    } as never);
    const data = h.tx.emailAccount.create.mock.calls[0][0].data;
    expect(data.smtpPassEnc).toBe('ENC(secret)');
    expect((out as Record<string, unknown>).smtpPassEnc).toBeUndefined();
  });

  it('unsets the existing default before creating a new default account', async () => {
    const h = build();
    h.tx.emailAccount.create.mockResolvedValueOnce({ id: 'a-2', label: 'Work', fromEmail: 'w@x.ro', smtpPassEnc: 'ENC(p)' });
    await h.svc.createAccount({
      label: 'Work',
      smtpHost: 'h',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'w@x.ro',
      smtpPass: 'p',
      fromName: 'W',
      fromEmail: 'w@x.ro',
      isDefault: true,
    } as never);
    expect(h.tx.emailAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1', isDefault: true }),
        data: { isDefault: false },
      }),
    );
  });
});

describe('EmailService.listAccounts + findAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list scopes by tenant + user + soft-delete and orders default-first', async () => {
    const h = build();
    h.tx.emailAccount.findMany.mockResolvedValueOnce([{ id: 'a-1', smtpPassEnc: 'ENC(p)' }]);
    const out = await h.svc.listAccounts();
    const args = h.tx.emailAccount.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'tenant-1', userId: 'user-1', deletedAt: null });
    expect(args.orderBy).toEqual([{ isDefault: 'desc' }, { createdAt: 'desc' }]);
    expect((out[0] as Record<string, unknown>).smtpPassEnc).toBeUndefined();
  });

  it('findAccount throws EMAIL_ACCOUNT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findAccount('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('EmailService.updateAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only re-encrypts smtpPass when it is part of the patch', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce({ id: 'a-1' });
    h.tx.emailAccount.update.mockResolvedValueOnce({ id: 'a-1', smtpPassEnc: 'ENC(old)' });
    await h.svc.updateAccount('a-1', { label: 'Renamed' } as never);
    const data = h.tx.emailAccount.update.mock.calls[0][0].data;
    expect('smtpPassEnc' in data).toBe(false);
    expect(data.label).toBe('Renamed');
  });

  it('encrypts a freshly-supplied smtpPass on patch', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce({ id: 'a-1' });
    h.tx.emailAccount.update.mockResolvedValueOnce({ id: 'a-1', smtpPassEnc: 'ENC(new)' });
    await h.svc.updateAccount('a-1', { smtpPass: 'new' } as never);
    const data = h.tx.emailAccount.update.mock.calls[0][0].data;
    expect(data.smtpPassEnc).toBe('ENC(new)');
  });
});

describe('EmailService.removeAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-deletes via deletedAt and audits with the label', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce({ id: 'a-1', label: 'Gmail' });
    h.tx.emailAccount.update.mockResolvedValueOnce({ id: 'a-1' });
    await h.svc.removeAccount('a-1');
    const data = h.tx.emailAccount.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email_account.delete', metadata: { label: 'Gmail' } }),
    );
  });
});

describe('EmailService.send', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the message, enqueues with jobId=message.id, and audits', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce({ id: 'a-1' });
    h.tx.emailMessage.create.mockResolvedValueOnce({ id: 'm-1', bodyHtml: '<p>Hi</p>' });
    await h.svc.send({
      accountId: 'a-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      toAddresses: ['x@y.ro'],
      ccAddresses: [],
      bccAddresses: [],
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
    } as never);
    expect(h.subjects.assertExists).toHaveBeenCalledWith('CONTACT', 'c-1');
    expect(h.emailQueue.add).toHaveBeenCalledWith(
      'send',
      { emailMessageId: 'm-1', tenantId: 'tenant-1' },
      { jobId: 'm-1' },
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.send', subjectType: 'contact' }),
    );
  });

  it('rewrites bodyHtml when tracking adds tracking pixels', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce({ id: 'a-1' });
    h.tx.emailMessage.create.mockResolvedValueOnce({ id: 'm-1', bodyHtml: '<p>Hi</p>' });
    h.tx.emailMessage.update.mockResolvedValueOnce({ id: 'm-1', bodyHtml: '<p>Hi</p><img/>' });
    vi.mocked(h.tracking.injectTracking).mockReturnValueOnce('<p>Hi</p><img/>');
    await h.svc.send({
      accountId: 'a-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      toAddresses: ['x@y.ro'],
      ccAddresses: [],
      bccAddresses: [],
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
    } as never);
    expect(h.tx.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-1' }, data: { bodyHtml: '<p>Hi</p><img/>' } }),
    );
  });
});

describe('EmailService.sendTransactional', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null silently when the tenant has no email account', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce(null);
    const out = await h.svc.sendTransactional('tenant-1', {
      to: 'x@y.ro',
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
    });
    expect(out).toBeNull();
    expect(h.emailQueue.add).not.toHaveBeenCalled();
  });

  it('uses the first active account and defaults subjectType=CONTACT', async () => {
    const h = build();
    h.tx.emailAccount.findFirst.mockResolvedValueOnce({ id: 'a-1' });
    h.tx.emailMessage.create.mockResolvedValueOnce({ id: 'm-9' });
    await h.svc.sendTransactional('tenant-1', {
      to: 'x@y.ro',
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
    });
    const data = h.tx.emailMessage.create.mock.calls[0][0].data;
    expect(data.subjectType).toBe('CONTACT');
    expect(data.toAddresses).toEqual(['x@y.ro']);
    expect(h.emailQueue.add).toHaveBeenCalled();
  });
});

describe('EmailService.listMessages + findMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listMessages applies subjectType / accountId / status filters when set', async () => {
    const h = build();
    h.tx.emailMessage.findMany.mockResolvedValueOnce([]);
    await h.svc.listMessages({
      limit: 25,
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      accountId: 'a-1',
      status: 'SENT',
    } as never);
    const where = h.tx.emailMessage.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      tenantId: 'tenant-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      accountId: 'a-1',
      status: 'SENT',
    });
  });

  it('findMessage throws EMAIL_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.emailMessage.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findMessage('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('EmailService.decryptPassword', () => {
  it('returns plaintext from the stored ENC() value', () => {
    const h = build();
    expect(h.svc.decryptPassword({ smtpPassEnc: 'ENC(p)' } as never)).toBe('p');
  });
});
