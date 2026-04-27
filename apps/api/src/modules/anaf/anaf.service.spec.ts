import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('../../common/resilience/circuit-breaker', () => ({
  getBreaker: vi.fn(() => ({
    exec: vi.fn(async (fn: () => unknown) => fn()),
  })),
}));

import { AnafService } from './anaf.service';

const ORIG_ENV = { ...process.env };

function build() {
  const tx = {
    invoice: { findFirst: vi.fn() },
    anafSubmission: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    anafSubmission: { upsert: vi.fn() },
  } as unknown as ConstructorParameters<typeof AnafService>[0];
  const redisStore = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        redisStore.set(k, v);
        return 'OK';
      }),
    },
  } as unknown as ConstructorParameters<typeof AnafService>[1];
  const svc = new AnafService(prisma, redis);
  return { svc, prisma, tx, redis, redisStore };
}

const sampleInvoice = {
  id: 'inv-1',
  series: 'F',
  number: 42,
  issueDate: new Date('2026-04-01T00:00:00Z'),
  dueDate: new Date('2026-04-30T00:00:00Z'),
  currency: 'RON',
  subtotal: { toString: () => '1000.00' },
  vatAmount: { toString: () => '190.00' },
  total: { toString: () => '1190.00' },
  notes: null,
  lines: [
    {
      position: 1,
      description: 'Consultanță',
      quantity: { toString: () => '1' },
      unitPrice: { toString: () => '1000.00' },
      vatRate: { toString: () => '19' },
      subtotal: { toString: () => '1000.00' },
      vatAmount: { toString: () => '190.00' },
      total: { toString: () => '1190.00' },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG_ENV };
  process.env.ANAF_VAT = 'RO12345678';
  process.env.ANAF_COMPANY_NAME = 'Acme';
  process.env.ANAF_ADDRESS = 'Str. X 1';
  process.env.ANAF_CITY = 'București';
  process.env.ANAF_COUNTY = 'B';
  process.env.ANAF_CLIENT_ID = 'cid';
  process.env.ANAF_CLIENT_SECRET = 'sec';
  process.env.ANAF_SANDBOX = 'true';
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe('AnafService.submitInvoice', () => {
  it('throws NotFound when the invoice is missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.submitInvoice('ghost')).rejects.toThrow(NotFoundException);
  });

  it('happy path: caches token in Redis, uploads XML, persists UPLOADED status', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValueOnce(sampleInvoice);

    // First fetch = OAuth2 token; second = upload.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ index_incarcare: 'IDX-9' }),
      } as Response);

    const out = await h.svc.submitInvoice('inv-1');

    expect(out).toEqual({ uploadIndex: 'IDX-9' });
    // Token was cached for 3000s
    expect(h.redis.client.set).toHaveBeenCalledWith(
      'anaf:token:tenant-1:sbx',
      'tok-123',
      'EX',
      3000,
    );
    // Upload URL hits the sandbox host
    const uploadCall = fetchSpy.mock.calls[1];
    expect(String(uploadCall[0])).toContain('webservicesp.anaf.ro');
    expect(String(uploadCall[0])).toContain('cif=12345678'); // RO prefix stripped
    // Submission row written with UPLOADED status + the XML
    const upsertArgs = vi.mocked(h.prisma.anafSubmission.upsert).mock.calls[0][0];
    expect(upsertArgs.create.status).toBe('UPLOADED');
    expect(upsertArgs.create.uploadIndex).toBe('IDX-9');
    expect(upsertArgs.create.xmlContent).toContain('<Invoice');
    fetchSpy.mockRestore();
  });

  it('reuses a cached token without hitting the OAuth endpoint', async () => {
    const h = build();
    h.redisStore.set('anaf:token:tenant-1:sbx', 'cached-tok');
    h.tx.invoice.findFirst.mockResolvedValueOnce(sampleInvoice);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ index_incarcare: 'IDX-9' }),
    } as Response);

    await h.svc.submitInvoice('inv-1');
    // Only ONE fetch — the upload — because token was cached.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('persists FAILED + throws when ANAF returns Errors', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValueOnce(sampleInvoice);

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ Errors: [{ errorMessage: 'CIF inactiv' }] }),
      } as Response);

    await expect(h.svc.submitInvoice('inv-1')).rejects.toThrow(/CIF inactiv/);
    const upsertArgs = vi.mocked(h.prisma.anafSubmission.upsert).mock.calls[0][0];
    expect(upsertArgs.create.status).toBe('FAILED');
    expect(upsertArgs.create.errorMessage).toBe('CIF inactiv');
    fetchSpy.mockRestore();
  });
});

describe('AnafService.checkStatus', () => {
  it('throws NotFound when no submission exists', async () => {
    const h = build();
    h.tx.anafSubmission.findUnique.mockResolvedValueOnce(null);
    await expect(h.svc.checkStatus('inv-1')).rejects.toThrow(NotFoundException);
  });

  it('returns the submission as-is when uploadIndex is missing (still queued locally)', async () => {
    const h = build();
    h.tx.anafSubmission.findUnique.mockResolvedValueOnce({
      invoiceId: 'inv-1',
      status: 'PENDING',
      uploadIndex: null,
    });
    const out = await h.svc.checkStatus('inv-1');
    expect((out as { uploadIndex: null }).uploadIndex).toBeNull();
  });

  it('maps stare="ok" → OK status and stamps validatedAt', async () => {
    const h = build();
    h.tx.anafSubmission.findUnique.mockResolvedValueOnce({
      invoiceId: 'inv-1',
      status: 'IN_VALIDATION',
      uploadIndex: 'IDX-9',
      downloadId: null,
      validatedAt: null,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ stare: 'ok', id_descarcare: 'DL-1' }),
      } as Response);
    await h.svc.checkStatus('inv-1');
    const upsertArgs = vi.mocked(h.prisma.anafSubmission.upsert).mock.calls[0][0];
    expect(upsertArgs.update.status).toBe('OK');
    expect(upsertArgs.update.downloadId).toBe('DL-1');
    expect(upsertArgs.update.validatedAt).toBeInstanceOf(Date);
    fetchSpy.mockRestore();
  });
});

describe('AnafService.getXml', () => {
  it('throws NotFound when no XML is stored', async () => {
    const h = build();
    h.tx.anafSubmission.findUnique.mockResolvedValueOnce(null);
    await expect(h.svc.getXml('inv-1')).rejects.toThrow(NotFoundException);
  });
  it('returns the stored XML payload', async () => {
    const h = build();
    h.tx.anafSubmission.findUnique.mockResolvedValueOnce({
      invoiceId: 'inv-1',
      xmlContent: '<Invoice/>',
    });
    expect(await h.svc.getXml('inv-1')).toBe('<Invoice/>');
  });
});
