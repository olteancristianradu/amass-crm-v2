import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 't-A', userId: 'u-1' })),
}));

import { EmailSuppressionService, hashEmail, maskEmail } from './email-suppression.service';

function build() {
  const tx = {
    emailSuppression: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof EmailSuppressionService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof EmailSuppressionService>[1];
  const svc = new EmailSuppressionService(prisma, audit);
  return { svc, prisma, tx, audit };
}

beforeEach(() => vi.clearAllMocks());

describe('hashEmail', () => {
  it('hashes lowercased + trimmed input deterministically', () => {
    const a = hashEmail('Foo@Bar.RO');
    const b = hashEmail('  foo@bar.ro  ');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs produce different hashes', () => {
    expect(hashEmail('a@x.ro')).not.toBe(hashEmail('b@x.ro'));
  });
});

describe('maskEmail', () => {
  it('masks local + domain prefix, preserves TLD (single-segment TLD)', () => {
    expect(maskEmail('foo@bar.com')).toBe('f****@b****.com');
    // NOTE: maskEmail uses lastIndexOf('.') so multi-segment TLDs ("co.uk")
    // only preserve the final segment. Documented trade-off — see comment in
    // email-suppression.service.ts. We assert the actual behaviour, not a
    // hypothetical PSL-aware variant.
    expect(maskEmail('John.Doe@example.co.uk')).toBe('j****@e****.uk');
  });

  it('returns sentinel for invalid emails', () => {
    expect(maskEmail('not-an-email')).toBe('****');
    expect(maskEmail('@bar.com')).toBe('****');
    expect(maskEmail('foo@')).toBe('****');
  });

  it('handles domains with no dot (hostname-only)', () => {
    expect(maskEmail('foo@localhost')).toBe('f****@l****');
  });
});

describe('EmailSuppressionService.isSuppressed', () => {
  it('returns null when not on list', async () => {
    const h = build();
    h.tx.emailSuppression.findUnique.mockResolvedValueOnce(null);
    expect(await h.svc.isSuppressed('t-A', 'a@x.ro')).toBeNull();
  });

  it('returns row data when on list (active)', async () => {
    const h = build();
    h.tx.emailSuppression.findUnique.mockResolvedValueOnce({
      id: 's-1',
      reason: 'USER_UNSUBSCRIBE',
      emailMasked: 'a****@x****.ro',
      expiresAt: null,
    });
    const out = await h.svc.isSuppressed('t-A', 'a@x.ro');
    expect(out).toEqual({ id: 's-1', reason: 'USER_UNSUBSCRIBE', emailMasked: 'a****@x****.ro' });
  });

  it('treats expired entries as NOT suppressed', async () => {
    const h = build();
    h.tx.emailSuppression.findUnique.mockResolvedValueOnce({
      id: 's-1',
      reason: 'MANUAL_ADD',
      emailMasked: 'a****@x****.ro',
      expiresAt: new Date(Date.now() - 60_000), // 1 min ago
    });
    expect(await h.svc.isSuppressed('t-A', 'a@x.ro')).toBeNull();
  });

  it('uses tenant-keyed unique index lookup', async () => {
    const h = build();
    h.tx.emailSuppression.findUnique.mockResolvedValueOnce(null);
    await h.svc.isSuppressed('t-A', 'a@x.ro');
    const args = h.tx.emailSuppression.findUnique.mock.calls[0][0];
    expect(args.where.tenantId_emailHash.tenantId).toBe('t-A');
    expect(args.where.tenantId_emailHash.emailHash).toBe(hashEmail('a@x.ro'));
  });
});

describe('EmailSuppressionService.add (admin)', () => {
  it('upserts hash + masked + reason + audits email.suppression.added', async () => {
    const h = build();
    h.tx.emailSuppression.upsert.mockResolvedValueOnce({
      id: 's-1',
      tenantId: 't-A',
      emailHash: hashEmail('a@x.ro'),
      emailMasked: 'a****@x****.ro',
      reason: 'MANUAL_ADD',
      source: 'csv',
      addedAt: new Date('2026-05-17T00:00:00Z'),
      expiresAt: null,
      addedById: 'u-1',
      notes: null,
    });
    const out = await h.svc.add({ email: 'a@x.ro', reason: 'MANUAL_ADD', source: 'csv' });
    expect(out.id).toBe('s-1');
    expect(out.emailMasked).toBe('a****@x****.ro');
    // No raw email or hash in response
    expect((out as unknown as Record<string, unknown>).emailHash).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).email).toBeUndefined();

    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'email.suppression.added',
        subjectType: 'email_suppression',
        subjectId: 's-1',
      }),
    );
  });

  it('passes addedById from ctx on create', async () => {
    const h = build();
    h.tx.emailSuppression.upsert.mockResolvedValueOnce({
      id: 's-1',
      emailMasked: 'a****@x****.ro',
      reason: 'COMPLAINT',
      source: null,
      addedAt: new Date(),
      expiresAt: null,
      addedById: 'u-1',
      notes: null,
    });
    await h.svc.add({ email: 'a@x.ro', reason: 'COMPLAINT' });
    const upsertArgs = h.tx.emailSuppression.upsert.mock.calls[0][0];
    expect(upsertArgs.create.addedById).toBe('u-1');
  });
});

describe('EmailSuppressionService.addSystem (bounce/unsub flow)', () => {
  it('upserts with system source + null addedById + tenant-scoped audit', async () => {
    const h = build();
    h.tx.emailSuppression.upsert.mockResolvedValueOnce({
      id: 's-2',
      emailMasked: 'a****@x****.ro',
      reason: 'BOUNCE_HARD',
      source: 'webhook:bounce:hard',
      addedAt: new Date(),
      expiresAt: null,
      addedById: null,
      notes: 'code=550',
    });
    const out = await h.svc.addSystem('t-A', 'a@x.ro', 'BOUNCE_HARD', 'webhook:bounce:hard', 'code=550');
    expect(out.emailMasked).toBe('a****@x****.ro');
    expect(out.source).toBe('webhook:bounce:hard');
    // Tenant explicitly passed (no ALS in webhook handler)
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-A',
        action: 'email.suppression.added',
        metadata: expect.objectContaining({ reason: 'BOUNCE_HARD' }),
      }),
    );
  });
});

describe('EmailSuppressionService.list', () => {
  it('returns paginated sanitised rows scoped to current tenant', async () => {
    const h = build();
    const rows = [
      {
        id: 's-1',
        emailMasked: 'a****@x****.ro',
        reason: 'USER_UNSUBSCRIBE',
        source: null,
        addedAt: new Date('2026-05-17T10:00:00Z'),
        expiresAt: null,
        addedById: null,
        notes: null,
      },
      {
        id: 's-2',
        emailMasked: 'b****@x****.ro',
        reason: 'BOUNCE_HARD',
        source: 'webhook',
        addedAt: new Date('2026-05-17T09:00:00Z'),
        expiresAt: null,
        addedById: null,
        notes: null,
      },
    ];
    h.tx.emailSuppression.findMany.mockResolvedValueOnce(rows);
    const out = await h.svc.list({ limit: 50 } as never);
    expect(out.data).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
    expect(out.data[0].emailMasked).toBe('a****@x****.ro');
    // Tenant filter applied
    expect(h.tx.emailSuppression.findMany.mock.calls[0][0].where.tenantId).toBe('t-A');
  });

  it('forwards reason filter into where clause', async () => {
    const h = build();
    h.tx.emailSuppression.findMany.mockResolvedValueOnce([]);
    await h.svc.list({ reason: 'SPAM_REPORT', limit: 25 } as never);
    expect(h.tx.emailSuppression.findMany.mock.calls[0][0].where.reason).toBe('SPAM_REPORT');
  });
});

describe('EmailSuppressionService.remove', () => {
  it('throws NotFound when entry missing', async () => {
    const h = build();
    h.tx.emailSuppression.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.remove('missing')).rejects.toThrow(NotFoundException);
  });

  it('deletes + emits email.suppression.removed audit', async () => {
    const h = build();
    h.tx.emailSuppression.findFirst.mockResolvedValueOnce({
      id: 's-1',
      emailMasked: 'a****@x****.ro',
      reason: 'MANUAL_ADD',
    });
    h.tx.emailSuppression.delete.mockResolvedValueOnce({});
    await h.svc.remove('s-1');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'email.suppression.removed',
        subjectId: 's-1',
      }),
    );
  });
});
