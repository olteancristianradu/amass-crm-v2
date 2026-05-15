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
  LEAD_PII_FIELDS,
} from './gdpr.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

function build() {
  // tx carries ALL methods that eraseContact/eraseClient/export* call inside
  // runWithTenant. Methods not relevant to a specific test default to vi.fn()
  // (resolves undefined) or mockResolvedValue([]) for findMany queries.
  const tx = {
    contact: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    note: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    reminder: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    activity: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    attachment: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    call: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    callTranscript: { updateMany: vi.fn() },
    emailMessage: { updateMany: vi.fn() },
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    leadScore: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    // Direct (outside runWithTenant) — used by sweepAllTenants only.
    contact: { findMany: vi.fn(), update: vi.fn() },
    client: { findMany: vi.fn(), update: vi.fn() },
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof GdprService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof GdprService>[1];
  const storage = { remove: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof GdprService>[2];
  const svc = new GdprService(prisma, audit, storage);
  return { svc, prisma, tx, audit, storage };
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

describe('GdprService.exportLead (GDPR Art. 20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset tenant context default for tests that don't override.
    vi.mocked(requireTenantContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' } as never);
  });

  it('throws LEAD_NOT_FOUND when the lead does not exist', async () => {
    const h = build();
    h.tx.lead.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.exportLead('ghost')).rejects.toThrow(NotFoundException);
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('returns the lead + leadScores + converted contact for an unconverted lead', async () => {
    const h = build();
    h.tx.lead.findFirst.mockResolvedValueOnce({
      id: 'l-1',
      firstName: 'Ion',
      lastName: 'Popescu',
      email: 'ion@example.com',
      convertedToContactId: null,
    } as never);
    h.tx.leadScore.findMany.mockResolvedValueOnce([
      { id: 'ls-1', score: 42, factors: { calls: 3 } },
    ] as never);

    const out = await h.svc.exportLead('l-1');

    expect(out.subject).toBe('LEAD');
    expect((out.lead as { id: string }).id).toBe('l-1');
    expect(out.leadScores).toHaveLength(1);
    expect(out.convertedContact).toBeNull();
    // Did NOT try to look up a contact (no convertedToContactId).
    expect(h.tx.contact.findFirst).not.toHaveBeenCalled();
    // LeadScore query is scoped by entityType='LEAD' + entityId.
    expect(h.tx.leadScore.findMany).toHaveBeenCalledWith({
      where: { entityType: 'LEAD', entityId: 'l-1' },
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr.export_lead', subjectId: 'l-1' }),
    );
  });

  it('also exports the converted contact row when the lead was converted', async () => {
    const h = build();
    h.tx.lead.findFirst.mockResolvedValueOnce({
      id: 'l-1',
      convertedToContactId: 'c-99',
    } as never);
    h.tx.contact.findFirst.mockResolvedValueOnce({
      id: 'c-99',
      firstName: 'Ion',
      email: 'ion@example.com',
    } as never);

    const out = await h.svc.exportLead('l-1');

    expect((out.convertedContact as { id: string }).id).toBe('c-99');
    expect(h.tx.contact.findFirst).toHaveBeenCalledWith({
      where: { id: 'c-99', deletedAt: null },
    });
  });

  it('multi-tenant isolation: runWithTenant uses the REQUEST tenant, not a hardcoded one (rule #3)', async () => {
    // Critical invariant: if request context is tenant-2, the export must
    // open the tx under tenant-2 — never under the lead's stored tenantId
    // (which could be spoofed) and never under a constant. The Prisma
    // extension + Postgres RLS then enforce the actual row isolation. This
    // test verifies the SERVICE plumbing is correct; RLS itself is tested
    // separately in the prisma integration suite.
    const h = build();
    vi.mocked(requireTenantContext).mockReturnValue({ tenantId: 'tenant-2', userId: 'user-9' } as never);
    h.tx.lead.findFirst.mockResolvedValueOnce({ id: 'l-1', convertedToContactId: null } as never);

    await h.svc.exportLead('l-1');

    // First positional arg to runWithTenant is the tenantId from ALS.
    expect(h.prisma.runWithTenant).toHaveBeenCalledWith('tenant-2', expect.any(Function));
    // And the lead lookup did NOT inject a tenantId in the where clause —
    // that's the extension's job. If a developer added one manually, this
    // would catch the drift.
    const whereArg = h.tx.lead.findFirst.mock.calls[0][0].where;
    expect(whereArg).not.toHaveProperty('tenantId');
  });

  it('multi-tenant isolation: a lead from a DIFFERENT tenant is not exported', async () => {
    // Simulates the extension-injected tenant filter rejecting the row.
    // In real Prisma + RLS, tx.lead.findFirst({where:{id:'l-other'}}) under
    // tenantId='tenant-1' returns null because RLS + extension filter the
    // query to tenant-1's rows. Our mocked findFirst returns null and the
    // service surfaces NotFoundException — the data is NOT exposed.
    const h = build();
    vi.mocked(requireTenantContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' } as never);
    // The lead 'l-other' exists in tenant-2 but the tenant-1-scoped tx
    // sees nothing → null.
    h.tx.lead.findFirst.mockResolvedValueOnce(null);

    await expect(h.svc.exportLead('l-other')).rejects.toThrow(NotFoundException);
    expect(h.audit.log).not.toHaveBeenCalled();
  });
});

describe('GdprService.eraseLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireTenantContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' } as never);
  });

  it('throws LEAD_NOT_FOUND if the lead does not exist', async () => {
    const h = build();
    h.tx.lead.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.eraseLead('ghost')).rejects.toThrow(NotFoundException);
    expect(h.tx.lead.update).not.toHaveBeenCalled();
  });

  it('anonymises every LEAD_PII_FIELDS column + sets deletedAt + audits', async () => {
    const h = build();
    h.tx.lead.findFirst.mockResolvedValueOnce({ id: 'l-1' } as never);
    h.tx.lead.update.mockResolvedValueOnce({});

    const out = await h.svc.eraseLead('l-1');

    const data = h.tx.lead.update.mock.calls[0][0].data;
    for (const field of LEAD_PII_FIELDS) {
      expect(data).toHaveProperty(field);
    }
    expect(data.firstName).toBe(ANON);
    expect(data.email).toBe(ANON_EMAIL);
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr.erase_lead', subjectId: 'l-1' }),
    );
    expect(out).toEqual({ erased: true });
  });
});

describe('GdprService.exportContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CONTACT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.contact.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.exportContact('ghost')).rejects.toThrow(NotFoundException);
  });

  it('returns the data package and redacts attachment storageKey', async () => {
    const h = build();
    h.tx.contact.findFirst.mockResolvedValueOnce({ id: 'c-1', firstName: 'A' } as never);
    h.tx.attachment.findMany.mockResolvedValueOnce([
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
    h.tx.contact.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.eraseContact('ghost')).rejects.toThrow(NotFoundException);
    expect(h.tx.contact.update).not.toHaveBeenCalled();
  });

  it('anonymises PII + hard-deletes notes/reminders/activities + audits', async () => {
    const h = build();
    h.tx.contact.findFirst.mockResolvedValueOnce({ id: 'c-1' } as never);
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
    h.tx.client.findFirst.mockResolvedValueOnce({ id: 'cl-1' } as never);
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
    h.tx.contact.findMany.mockResolvedValueOnce([
      { id: 'c-1' },
      { id: 'c-2' },
    ] as never);
    h.tx.client.findMany.mockResolvedValueOnce([{ id: 'cl-1' }] as never);
    // Each erase{Contact,Client} re-runs findFirst inside its own runWithTenant call.
    h.tx.contact.findFirst
      .mockResolvedValueOnce({ id: 'c-1' } as never)
      .mockResolvedValueOnce({ id: 'c-2' } as never);
    h.tx.client.findFirst.mockResolvedValueOnce({ id: 'cl-1' } as never);

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
    h.tx.contact.findMany.mockResolvedValueOnce([] as never);
    h.tx.client.findMany.mockResolvedValueOnce([] as never);
    const before = Date.now();
    await h.svc.retentionSweep(7);
    const where = vi.mocked(h.tx.contact.findMany).mock.calls[0]![0]!.where as {
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
