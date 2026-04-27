import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import {
  ANON,
  ANON_EMAIL,
  GdprService,
  buildContactAnonymisationPatch,
  buildClientAnonymisationPatch,
  CONTACT_PII_FIELDS,
  CLIENT_PII_FIELDS,
} from './gdpr.service';

function build() {
  const tx = {
    contact: { update: vi.fn() },
    client: { update: vi.fn() },
    note: { deleteMany: vi.fn() },
    reminder: { deleteMany: vi.fn() },
    activity: { deleteMany: vi.fn() },
  };
  const prisma = {
    contact: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    note: { findMany: vi.fn().mockResolvedValue([]) },
    activity: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { findMany: vi.fn().mockResolvedValue([]) },
    reminder: { findMany: vi.fn().mockResolvedValue([]) },
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof GdprService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof GdprService>[1];
  const svc = new GdprService(prisma, audit);
  return { svc, prisma, tx, audit };
}

describe('Anonymisation patch helpers', () => {
  it('contact patch resets every PII field to ANON or null + sets deletedAt', () => {
    const now = new Date('2026-04-27T10:00:00Z');
    const p = buildContactAnonymisationPatch(now);
    for (const field of CONTACT_PII_FIELDS) {
      expect(field in p).toBe(true);
    }
    expect(p.firstName).toBe(ANON);
    expect(p.email).toBe(ANON_EMAIL);
    expect(p.phone).toBeNull();
    expect(p.deletedAt).toBe(now);
  });

  it('client patch covers every CLIENT_PII_FIELDS entry', () => {
    const p = buildClientAnonymisationPatch();
    for (const field of CLIENT_PII_FIELDS) {
      expect(field in p).toBe(true);
    }
  });
});

describe('GdprService.exportContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CONTACT_NOT_FOUND when missing', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findFirst).mockResolvedValueOnce(null);
    await expect(h.svc.exportContact('ghost')).rejects.toThrow(NotFoundException);
  });

  it('returns the data package and redacts attachment storageKey', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findFirst).mockResolvedValueOnce({ id: 'c-1', firstName: 'A' } as never);
    vi.mocked(h.prisma.attachment.findMany).mockResolvedValueOnce([
      { id: 'att-1', storageKey: 'tenant-1/abc/file.pdf', fileName: 'x.pdf' } as never,
    ]);
    const out = await h.svc.exportContact('c-1');
    expect(out.subject).toBe('CONTACT');
    expect((out.attachments as { storageKey: string }[])[0].storageKey).toBe('[REDACTED]');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr.export_contact', subjectId: 'c-1' }),
    );
  });
});

describe('GdprService.eraseContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to act on a non-existent / already-deleted contact', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findFirst).mockResolvedValueOnce(null);
    await expect(h.svc.eraseContact('ghost')).rejects.toThrow(NotFoundException);
    expect(h.tx.contact.update).not.toHaveBeenCalled();
  });

  it('anonymises PII + hard-deletes notes/reminders/activities + audits', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findFirst).mockResolvedValueOnce({ id: 'c-1' } as never);
    h.tx.contact.update.mockResolvedValueOnce({});
    h.tx.note.deleteMany.mockResolvedValueOnce({ count: 3 });
    h.tx.reminder.deleteMany.mockResolvedValueOnce({ count: 2 });
    h.tx.activity.deleteMany.mockResolvedValueOnce({ count: 5 });
    const out = await h.svc.eraseContact('c-1');
    const data = h.tx.contact.update.mock.calls[0][0].data;
    expect(data.firstName).toBe(ANON);
    expect(data.email).toBe(ANON_EMAIL);
    expect(data.phone).toBeNull();
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.tx.note.deleteMany).toHaveBeenCalled();
    expect(h.tx.reminder.deleteMany).toHaveBeenCalled();
    expect(h.tx.activity.deleteMany).toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr.erase_contact' }),
    );
    expect(out).toEqual({ erased: true });
  });
});

describe('GdprService.eraseClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('also nulls addressLine (clients have addresses, contacts do not)', async () => {
    const h = build();
    vi.mocked(h.prisma.client.findFirst).mockResolvedValueOnce({ id: 'cl-1' } as never);
    h.tx.client.update.mockResolvedValueOnce({});
    h.tx.note.deleteMany.mockResolvedValueOnce({ count: 0 });
    h.tx.reminder.deleteMany.mockResolvedValueOnce({ count: 0 });
    h.tx.activity.deleteMany.mockResolvedValueOnce({ count: 0 });
    await h.svc.eraseClient('cl-1');
    const data = h.tx.client.update.mock.calls[0][0].data;
    expect(data.addressLine).toBeNull();
    expect(data.firstName).toBe(ANON);
  });
});

describe('GdprService.retentionSweep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds stale records past the cutoff and anonymises each', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findMany).mockResolvedValueOnce([
      { id: 'c-1' },
      { id: 'c-2' },
    ] as never);
    vi.mocked(h.prisma.client.findMany).mockResolvedValueOnce([{ id: 'cl-1' }] as never);
    // Each erase{Contact,Client} re-runs findFirst inside erase* — set up.
    vi.mocked(h.prisma.contact.findFirst)
      .mockResolvedValueOnce({ id: 'c-1' } as never)
      .mockResolvedValueOnce({ id: 'c-2' } as never);
    vi.mocked(h.prisma.client.findFirst).mockResolvedValueOnce({ id: 'cl-1' } as never);

    const out = await h.svc.retentionSweep(30);

    expect(out).toEqual({ contacts: 2, clients: 1 });
    expect(h.tx.contact.update).toHaveBeenCalledTimes(2);
    expect(h.tx.client.update).toHaveBeenCalledTimes(1);
    // The summary audit log fires once at the end — separate from per-row erasure logs.
    const summaryCalls = vi
      .mocked(h.audit.log)
      .mock.calls.filter((c) => c[0].action === 'gdpr.retention_sweep');
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0][0].metadata).toEqual({
      contacts: 2,
      clients: 1,
      retentionDays: 30,
    });
  });

  it('uses cutoff = now - retentionDays * 86400000 ms in the where filter', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(h.prisma.client.findMany).mockResolvedValueOnce([] as never);
    const before = Date.now();
    await h.svc.retentionSweep(7);
    const where = vi.mocked(h.prisma.contact.findMany).mock.calls[0][0]!.where as {
      deletedAt: { lte: Date };
    };
    const cutoff = where.deletedAt.lte.getTime();
    const expected = before - 7 * 86400000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(1000); // within 1s
    expect(where).toMatchObject({ NOT: { firstName: ANON } });
  });
});

describe('GdprService.sweepAllTenants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('iterates without requireTenantContext + writes anonymised values directly', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findMany).mockResolvedValueOnce([
      { id: 'c-1', tenantId: 't-A' },
      { id: 'c-2', tenantId: 't-B' },
    ] as never);
    vi.mocked(h.prisma.client.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(h.prisma.contact.update).mockResolvedValue({} as never);
    const out = await h.svc.sweepAllTenants(365);
    expect(out.total).toEqual({ contacts: 2, clients: 0 });
    expect(vi.mocked(h.prisma.contact.update)).toHaveBeenCalledTimes(2);
  });

  it('continues on per-row update failure (logs but does not throw)', async () => {
    const h = build();
    vi.mocked(h.prisma.contact.findMany).mockResolvedValueOnce([
      { id: 'c-1', tenantId: 't' },
      { id: 'c-2', tenantId: 't' },
    ] as never);
    vi.mocked(h.prisma.client.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(h.prisma.contact.update)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({} as never);
    const out = await h.svc.sweepAllTenants(365);
    // Both rows count even though one failed — counter is incremented before await.
    expect(out.total.contacts).toBe(2);
  });
});
