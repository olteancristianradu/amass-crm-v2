import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentPurpose, ConsentStatus, LawfulBasis, SubjectType } from '@prisma/client';
import { ConsentsService } from './consents.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    consentRecord: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof ConsentsService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof ConsentsService>[1];
  const svc = new ConsentsService(prisma, audit);
  return { svc, prisma, tx, audit };
}

describe('ConsentsService.grant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a new GRANTED row with tenant scoping', async () => {
    const h = build();
    h.tx.consentRecord.create.mockResolvedValueOnce({
      id: 'c-1', status: ConsentStatus.GRANTED,
    });
    await h.svc.grant({
      subjectType: SubjectType.CONTACT,
      subjectId: 'contact-1',
      purpose: ConsentPurpose.MARKETING_EMAIL,
      lawfulBasis: LawfulBasis.CONSENT,
      source: 'signup_form',
      ipAddress: '10.0.0.1',
    });
    const data = h.tx.consentRecord.create.mock.calls[0]![0]!.data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.status).toBe(ConsentStatus.GRANTED);
    expect(data.purpose).toBe(ConsentPurpose.MARKETING_EMAIL);
    expect(data.grantedAt).toBeInstanceOf(Date);
    expect(data.revokedAt).toBeUndefined();
    expect(data.source).toBe('signup_form');
  });

  it('emits an audit log on grant', async () => {
    const h = build();
    h.tx.consentRecord.create.mockResolvedValueOnce({ id: 'c-2' });
    await h.svc.grant({
      subjectType: SubjectType.CLIENT,
      subjectId: 'client-1',
      purpose: ConsentPurpose.CALL_RECORDING,
      lawfulBasis: LawfulBasis.CONSENT,
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.grant',
        subjectType: 'CLIENT',
        subjectId: 'client-1',
      }),
    );
  });
});

describe('ConsentsService.revoke', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a REVOKED row (does NOT update existing) and inherits lawfulBasis', async () => {
    const h = build();
    h.tx.consentRecord.findFirst.mockResolvedValueOnce({
      id: 'g-1',
      lawfulBasis: LawfulBasis.LEGITIMATE_INTEREST,
    });
    h.tx.consentRecord.create.mockResolvedValueOnce({ id: 'r-1', status: ConsentStatus.REVOKED });
    await h.svc.revoke({
      subjectType: SubjectType.CONTACT,
      subjectId: 'contact-9',
      purpose: ConsentPurpose.MARKETING_EMAIL,
      source: 'unsubscribe_link',
    });
    const data = h.tx.consentRecord.create.mock.calls[0]![0]!.data;
    expect(data.status).toBe(ConsentStatus.REVOKED);
    expect(data.lawfulBasis).toBe(LawfulBasis.LEGITIMATE_INTEREST);
    expect(data.revokedAt).toBeInstanceOf(Date);
  });

  it('defaults lawfulBasis to CONSENT if no prior grant exists', async () => {
    const h = build();
    h.tx.consentRecord.findFirst.mockResolvedValueOnce(null);
    h.tx.consentRecord.create.mockResolvedValueOnce({ id: 'r-2' });
    await h.svc.revoke({
      subjectType: SubjectType.CONTACT,
      subjectId: 'contact-99',
      purpose: ConsentPurpose.NEWSLETTER,
    });
    const data = h.tx.consentRecord.create.mock.calls[0]![0]!.data;
    expect(data.lawfulBasis).toBe(LawfulBasis.CONSENT);
  });

  it('emits audit with previousGrantId when prior grant exists', async () => {
    const h = build();
    h.tx.consentRecord.findFirst.mockResolvedValueOnce({ id: 'prev-grant', lawfulBasis: LawfulBasis.CONSENT });
    h.tx.consentRecord.create.mockResolvedValueOnce({ id: 'r-3' });
    await h.svc.revoke({
      subjectType: SubjectType.CONTACT,
      subjectId: 'contact-7',
      purpose: ConsentPurpose.MARKETING_SMS,
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.revoke',
        metadata: expect.objectContaining({ previousGrantId: 'prev-grant' }),
      }),
    );
  });
});

describe('ConsentsService.currentByPurpose', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the latest record per purpose (deduped by purpose)', async () => {
    const h = build();
    const now = new Date('2026-04-29T10:00:00Z');
    const earlier = new Date('2026-04-28T10:00:00Z');
    h.tx.consentRecord.findMany.mockResolvedValueOnce([
      { id: '1', purpose: ConsentPurpose.MARKETING_EMAIL, status: ConsentStatus.REVOKED, createdAt: now },
      { id: '2', purpose: ConsentPurpose.MARKETING_EMAIL, status: ConsentStatus.GRANTED, createdAt: earlier },
      { id: '3', purpose: ConsentPurpose.NEWSLETTER, status: ConsentStatus.GRANTED, createdAt: now },
    ]);
    const result = await h.svc.currentByPurpose(SubjectType.CONTACT, 'c-1');
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.purpose === ConsentPurpose.MARKETING_EMAIL)?.id).toBe('1');
    expect(result.find((r) => r.purpose === ConsentPurpose.NEWSLETTER)?.id).toBe('3');
  });

  it('returns empty array when no records', async () => {
    const h = build();
    h.tx.consentRecord.findMany.mockResolvedValueOnce([]);
    const result = await h.svc.currentByPurpose(SubjectType.CLIENT, 'cl-1');
    expect(result).toEqual([]);
  });
});

describe('ConsentsService.hasConsent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true if the latest record is GRANTED', async () => {
    const h = build();
    h.tx.consentRecord.findFirst.mockResolvedValueOnce({
      status: ConsentStatus.GRANTED,
      purpose: ConsentPurpose.MARKETING_EMAIL,
    });
    const r = await h.svc.hasConsent(SubjectType.CONTACT, 'c-1', ConsentPurpose.MARKETING_EMAIL);
    expect(r).toBe(true);
  });

  it('returns false if the latest record is REVOKED (overrides earlier grant)', async () => {
    const h = build();
    h.tx.consentRecord.findFirst.mockResolvedValueOnce({
      status: ConsentStatus.REVOKED,
      purpose: ConsentPurpose.MARKETING_SMS,
    });
    const r = await h.svc.hasConsent(SubjectType.CONTACT, 'c-1', ConsentPurpose.MARKETING_SMS);
    expect(r).toBe(false);
  });

  it('returns false if no records exist', async () => {
    const h = build();
    h.tx.consentRecord.findFirst.mockResolvedValueOnce(null);
    const r = await h.svc.hasConsent(SubjectType.CONTACT, 'unknown', ConsentPurpose.NEWSLETTER);
    expect(r).toBe(false);
  });
});
