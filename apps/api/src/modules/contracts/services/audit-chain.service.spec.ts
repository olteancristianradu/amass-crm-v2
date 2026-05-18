import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditChainService } from './audit-chain.service';

vi.mock('../../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    contractAuditEntry: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof AuditChainService>[0];
  const svc = new AuditChainService(prisma);
  return { svc, prisma, tx };
}

describe('AuditChainService.computeHash', () => {
  const svc = new AuditChainService({} as never);

  it('is deterministic for the same input', () => {
    const a = svc.computeHash({
      prevEntryHash: null,
      eventType: 'CONTRACT_CREATED',
      actorId: 'user-1',
      createdAtIso: '2026-01-01T00:00:00.000Z',
      payload: { foo: 'bar' },
    });
    const b = svc.computeHash({
      prevEntryHash: null,
      eventType: 'CONTRACT_CREATED',
      actorId: 'user-1',
      createdAtIso: '2026-01-01T00:00:00.000Z',
      payload: { foo: 'bar' },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sorts payload keys so order does not affect the hash', () => {
    const a = svc.computeHash({
      prevEntryHash: null,
      eventType: 'CONTRACT_CREATED',
      actorId: null,
      createdAtIso: '2026-01-01T00:00:00.000Z',
      payload: { a: 1, b: 2 },
    });
    const b = svc.computeHash({
      prevEntryHash: null,
      eventType: 'CONTRACT_CREATED',
      actorId: null,
      createdAtIso: '2026-01-01T00:00:00.000Z',
      payload: { b: 2, a: 1 },
    });
    expect(a).toBe(b);
  });

  it('produces a different hash when any input field flips', () => {
    const base = {
      prevEntryHash: null,
      eventType: 'CONTRACT_CREATED' as const,
      actorId: null,
      createdAtIso: '2026-01-01T00:00:00.000Z',
      payload: { x: 1 },
    };
    const a = svc.computeHash(base);
    const b = svc.computeHash({ ...base, payload: { x: 2 } });
    const c = svc.computeHash({ ...base, eventType: 'CONTRACT_UPDATED' });
    const d = svc.computeHash({ ...base, prevEntryHash: 'abc' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('AuditChainService.append', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the genesis entry with prevEntryHash=null', async () => {
    const h = build();
    h.tx.contractAuditEntry.findFirst.mockResolvedValueOnce(null);
    h.tx.contractAuditEntry.create.mockResolvedValueOnce({ id: 'a1' });
    await h.svc.append(h.tx as never, {
      contractId: 'c1',
      eventType: 'CONTRACT_CREATED',
      actorType: 'TENANT_USER',
      actorId: 'user-1',
    });
    const data = h.tx.contractAuditEntry.create.mock.calls[0][0].data;
    expect(data.prevEntryHash).toBeNull();
    expect(data.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.tenantId).toBe('tenant-1');
  });

  it('chains the new entry to the previous one', async () => {
    const h = build();
    h.tx.contractAuditEntry.findFirst.mockResolvedValueOnce({ entryHash: 'prev123' });
    h.tx.contractAuditEntry.create.mockResolvedValueOnce({ id: 'a2' });
    await h.svc.append(h.tx as never, {
      contractId: 'c1',
      eventType: 'SIGNATURE_SUBMITTED',
      actorType: 'SIGNER',
      actorId: 's1',
    });
    const data = h.tx.contractAuditEntry.create.mock.calls[0][0].data;
    expect(data.prevEntryHash).toBe('prev123');
    expect(data.entryHash).not.toBe('prev123');
  });
});

describe('AuditChainService.verifyContractChain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok when the chain matches', async () => {
    const h = build();
    const t = new Date('2026-01-01T00:00:00.000Z');
    const h1 = h.svc.computeHash({
      prevEntryHash: null,
      eventType: 'CONTRACT_CREATED',
      actorId: 'u1',
      createdAtIso: t.toISOString(),
      payload: { a: 1 },
    });
    const h2 = h.svc.computeHash({
      prevEntryHash: h1,
      eventType: 'PDF_RENDERED',
      actorId: 'u1',
      createdAtIso: t.toISOString(),
      payload: { b: 2 },
    });
    h.tx.contractAuditEntry.findMany.mockResolvedValueOnce([
      { id: 'a', entryHash: h1, prevEntryHash: null, eventType: 'CONTRACT_CREATED', actorId: 'u1', createdAt: t, payload: { a: 1 } },
      { id: 'b', entryHash: h2, prevEntryHash: h1, eventType: 'PDF_RENDERED', actorId: 'u1', createdAt: t, payload: { b: 2 } },
    ]);
    await expect(h.svc.verifyContractChain('tenant-1', 'c1')).resolves.toEqual({ ok: true });
  });

  it('flags the first bad entry when a hash mismatches', async () => {
    const h = build();
    const t = new Date('2026-01-01T00:00:00.000Z');
    h.tx.contractAuditEntry.findMany.mockResolvedValueOnce([
      { id: 'a', entryHash: 'wrong', prevEntryHash: null, eventType: 'CONTRACT_CREATED', actorId: null, createdAt: t, payload: {} },
    ]);
    await expect(h.svc.verifyContractChain('tenant-1', 'c1')).resolves.toEqual({
      ok: false,
      firstBadEntryId: 'a',
    });
  });
});
