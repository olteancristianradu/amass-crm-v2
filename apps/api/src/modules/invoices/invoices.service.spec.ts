import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function makeExistingDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    status: 'DRAFT',
    companyId: 'company-1',
    series: 'AMS',
    number: 42,
    pdfStorageKey: null,
    currency: 'RON',
    lines: [],
    payments: [],
    ...overrides,
  };
}

/**
 * InvoicesService does all DB work inside `runWithTenant(tenantId, fn)`
 * where `fn` receives a transaction handle — the real Prisma transaction.
 * We stub runWithTenant to just invoke the fn with a `tx` object, so the
 * service's `tx.invoice.*` calls land on our spies.
 */
function build() {
  const tx = {
    invoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof InvoicesService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof InvoicesService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof InvoicesService>[2];
  const storage = {} as unknown as ConstructorParameters<typeof InvoicesService>[3];
  const pdf = {} as unknown as ConstructorParameters<typeof InvoicesService>[4];
  const svc = new InvoicesService(prisma, audit, activities, storage, pdf);
  return { svc, prisma, tx, audit, activities };
}

describe('InvoicesService.changeStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid FSM transition (PAID → DRAFT)', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ status: 'PAID' }));
    await expect(h.svc.changeStatus('inv-1', { status: 'DRAFT' })).rejects.toThrow(BadRequestException);
  });

  it('allows DRAFT → CANCELLED without generating a PDF', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft());
    h.tx.invoice.update.mockResolvedValue({ ...makeExistingDraft(), status: 'CANCELLED' });
    const out = await h.svc.changeStatus('inv-1', { status: 'CANCELLED' });
    expect(out.status).toBe('CANCELLED');
    expect(h.tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });

  it('audit-logs every status change', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ status: 'ISSUED' }));
    h.tx.invoice.update.mockResolvedValue({ ...makeExistingDraft(), status: 'CANCELLED' });
    await h.svc.changeStatus('inv-1', { status: 'CANCELLED' });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.status', subjectId: 'inv-1' }),
    );
  });
});

describe('InvoicesService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws INVOICE_NOT_DELETABLE for ISSUED invoices (legal invariant)', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ status: 'ISSUED' }));
    await expect(h.svc.remove('inv-1')).rejects.toThrow(BadRequestException);
  });

  it('throws INVOICE_NOT_DELETABLE for PAID invoices', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ status: 'PAID' }));
    await expect(h.svc.remove('inv-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when invoice missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(null);
    await expect(h.svc.remove('inv-missing')).rejects.toThrow(NotFoundException);
  });
});

describe('InvoicesService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when invoice missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(null);
    await expect(h.svc.findOne('nope')).rejects.toThrow(NotFoundException);
  });

  it('returns with lines + payments on hit', async () => {
    const h = build();
    const fake = makeExistingDraft({ lines: [{ id: 'line-1' }], payments: [] });
    h.tx.invoice.findFirst.mockResolvedValue(fake);
    const out = await h.svc.findOne('inv-1');
    expect(out.id).toBe('inv-1');
    expect(out.lines.length).toBe(1);
  });
});
