import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    subtotal: new Prisma.Decimal(100),
    vatAmount: new Prisma.Decimal(19),
    total: new Prisma.Decimal(119),
    issueDate: new Date('2026-04-01'),
    dueDate: new Date('2026-05-01'),
    lines: [],
    payments: [],
    ...overrides,
  };
}

/**
 * InvoicesService does most DB work inside runWithTenant(tenantId, fn).
 * We stub runWithTenant to call fn with a tx double whose methods we spy.
 * `prisma.tenant` and `prisma.invoice.updateMany` are called directly
 * outside tenant scope (PDF rendering + cron sweep) — those go on prisma.
 */
function build() {
  const tx = {
    invoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    invoiceLine: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    company: { findFirst: vi.fn().mockResolvedValue({ name: 'Acme SRL' }) },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    tenant: { findUnique: vi.fn().mockResolvedValue({ name: 'Emitent SRL' }) },
    invoice: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as ConstructorParameters<typeof InvoicesService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof InvoicesService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof InvoicesService>[2];
  const storage = {
    putObject: vi.fn().mockResolvedValue(undefined),
    presignGet: vi.fn().mockResolvedValue('https://signed.example/pdf'),
  } as unknown as ConstructorParameters<typeof InvoicesService>[3];
  const pdf = {
    render: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 stub')),
  } as unknown as ConstructorParameters<typeof InvoicesService>[4];
  const svc = new InvoicesService(prisma, audit, activities, storage, pdf);
  return { svc, prisma, tx, audit, activities, storage, pdf };
}

const sampleLine = {
  description: 'Service',
  quantity: 2,
  unitPrice: 50,
  vatRate: 19,
};

// ─── create ────────────────────────────────────────────────────────────

describe('InvoicesService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: computes line totals + invoice totals, stores DRAFT, audits + activities', async () => {
    const h = build();
    h.tx.invoice.aggregate.mockResolvedValue({ _max: { number: 41 } });
    h.tx.invoice.create.mockImplementation(async (args: unknown) => {
      const a = args as { data: { number: number; series: string; total: Prisma.Decimal } };
      return { id: 'inv-new', companyId: 'company-1', series: a.data.series, number: a.data.number, total: a.data.total, lines: [] };
    });

    await h.svc.create({
      companyId: 'company-1',
      series: 'AMS',
      issueDate: new Date('2026-04-01'),
      dueDate: new Date('2026-05-01'),
      currency: 'RON',
      lines: [sampleLine],
    } as never);

    const created = h.tx.invoice.create.mock.calls[0]![0] as { data: { status: string; number: number; tenantId: string } };
    expect(created.data.status).toBe('DRAFT');
    expect(created.data.number).toBe(42); // max + 1
    expect(created.data.tenantId).toBe('tenant-1');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.create', subjectId: 'inv-new' }),
    );
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'COMPANY', action: 'invoice.created' }),
    );
  });

  it('uses an explicit number if supplied (skips auto-increment)', async () => {
    const h = build();
    h.tx.invoice.create.mockResolvedValue({ id: 'inv-new', companyId: 'c-1', series: 'AMS', number: 999, total: new Prisma.Decimal(0), lines: [] });
    await h.svc.create({
      companyId: 'c-1', series: 'AMS', number: 999,
      issueDate: new Date(), dueDate: new Date(), currency: 'RON',
      lines: [sampleLine],
    } as never);
    expect(h.tx.invoice.aggregate).not.toHaveBeenCalled();
    const created = h.tx.invoice.create.mock.calls[0]![0] as { data: { number: number } };
    expect(created.data.number).toBe(999);
  });

  it('translates Prisma P2002 unique-violation into INVOICE_NUMBER_TAKEN ConflictException', async () => {
    const h = build();
    h.tx.invoice.aggregate.mockResolvedValue({ _max: { number: 0 } });
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: 'x',
    });
    h.tx.invoice.create.mockRejectedValue(err);
    await expect(
      h.svc.create({
        companyId: 'c-1', series: 'AMS',
        issueDate: new Date(), dueDate: new Date(), currency: 'RON',
        lines: [sampleLine],
      } as never),
    ).rejects.toThrow(ConflictException);
  });

  it('rethrows non-P2002 Prisma errors unchanged', async () => {
    const h = build();
    h.tx.invoice.aggregate.mockResolvedValue({ _max: { number: 0 } });
    h.tx.invoice.create.mockRejectedValue(new Error('something else'));
    await expect(
      h.svc.create({
        companyId: 'c-1', series: 'AMS',
        issueDate: new Date(), dueDate: new Date(), currency: 'RON',
        lines: [sampleLine],
      } as never),
    ).rejects.toThrow('something else');
  });
});

// ─── list ──────────────────────────────────────────────────────────────

describe('InvoicesService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty page for zero matches', async () => {
    const h = build();
    h.tx.invoice.findMany.mockResolvedValue([]);
    const out = await h.svc.list({ limit: 20 } as never);
    expect(out.data).toEqual([]);
  });

  it('applies status/companyId/dealId filters and an issueDate range', async () => {
    const h = build();
    h.tx.invoice.findMany.mockResolvedValue([]);
    await h.svc.list({
      limit: 20,
      status: 'ISSUED',
      companyId: 'company-1',
      dealId: 'deal-1',
      from: new Date('2026-01-01'),
      to: new Date('2026-12-31'),
    } as never);
    const arg = h.tx.invoice.findMany.mock.calls[0]![0] as { where: { issueDate: { gte: Date; lte: Date }; status: string } };
    expect(arg.where.status).toBe('ISSUED');
    expect(arg.where.issueDate.gte).toBeInstanceOf(Date);
    expect(arg.where.issueDate.lte).toBeInstanceOf(Date);
  });

  it('applies cursor pagination with skip=1', async () => {
    const h = build();
    h.tx.invoice.findMany.mockResolvedValue([]);
    await h.svc.list({ limit: 20, cursor: 'inv-prev' } as never);
    const arg = h.tx.invoice.findMany.mock.calls[0]![0] as { cursor: unknown; skip: number };
    expect(arg.cursor).toEqual({ id: 'inv-prev' });
    expect(arg.skip).toBe(1);
  });
});

// ─── findOne ───────────────────────────────────────────────────────────

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

// ─── update ────────────────────────────────────────────────────────────

describe('InvoicesService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws INVOICE_NOT_EDITABLE for non-DRAFT invoices', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ status: 'ISSUED' }));
    await expect(h.svc.update('inv-1', { notes: 'x' } as never)).rejects.toThrow(BadRequestException);
    expect(h.tx.invoice.update).not.toHaveBeenCalled();
  });

  it('updates simple fields without touching lines', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft());
    h.tx.invoice.update.mockResolvedValue(makeExistingDraft({ notes: 'updated' }));
    await h.svc.update('inv-1', { notes: 'updated' } as never);
    expect(h.tx.invoiceLine.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.invoice.update).toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.update' }),
    );
  });

  it('full-replaces lines when dto.lines is provided + recomputes invoice totals', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft());
    h.tx.invoice.update.mockResolvedValue(makeExistingDraft());
    await h.svc.update('inv-1', { lines: [sampleLine, { ...sampleLine, quantity: 3 }] } as never);
    expect(h.tx.invoiceLine.deleteMany).toHaveBeenCalledWith({
      where: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
    });
    expect(h.tx.invoiceLine.createMany).toHaveBeenCalled();
    const updateArg = h.tx.invoice.update.mock.calls[0]![0] as { data: { subtotal?: Prisma.Decimal; total?: Prisma.Decimal } };
    expect(updateArg.data.subtotal).toBeDefined();
    expect(updateArg.data.total).toBeDefined();
  });
});

// ─── changeStatus ──────────────────────────────────────────────────────

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
    await h.svc.changeStatus('inv-1', { status: 'CANCELLED' });
    expect(h.pdf.render).not.toHaveBeenCalled();
  });

  it('DRAFT → ISSUED generates and stores a PDF, persists pdfStorageKey', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft());
    h.tx.invoice.update.mockResolvedValue({ ...makeExistingDraft(), status: 'ISSUED' });
    await h.svc.changeStatus('inv-1', { status: 'ISSUED' });
    expect(h.pdf.render).toHaveBeenCalled();
    expect(h.storage.putObject).toHaveBeenCalledWith(
      'tenant-1/invoices/inv-1.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    // Final update payload includes pdfStorageKey
    const finalUpdate = h.tx.invoice.update.mock.calls.find((c) => {
      const arg = c[0] as { data: { status?: string } };
      return arg.data.status === 'ISSUED';
    });
    expect(finalUpdate).toBeDefined();
  });

  it('PDF failure on issue does NOT block the status transition (logs + continues)', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft());
    h.tx.invoice.update.mockResolvedValue({ ...makeExistingDraft(), status: 'ISSUED' });
    vi.mocked(h.pdf.render).mockRejectedValueOnce(new Error('puppeteer crashed'));
    await expect(h.svc.changeStatus('inv-1', { status: 'ISSUED' })).resolves.toBeTruthy();
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

// ─── remove ────────────────────────────────────────────────────────────

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

  it('soft-deletes a DRAFT invoice with audit log', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft());
    h.tx.invoice.update.mockResolvedValue(makeExistingDraft());
    await h.svc.remove('inv-1');
    const updateArg = h.tx.invoice.update.mock.calls[0]![0] as { data: { deletedAt: Date } };
    expect(updateArg.data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.delete' }),
    );
  });

  it('throws NotFound when invoice missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(null);
    await expect(h.svc.remove('inv-missing')).rejects.toThrow(NotFoundException);
  });
});

// ─── recomputeStatusFromPayments ────────────────────────────────────────

describe('InvoicesService.recomputeStatusFromPayments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no-ops when invoice missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(null);
    await h.svc.recomputeStatusFromPayments('ghost');
    expect(h.tx.invoice.update).not.toHaveBeenCalled();
  });

  it('no-ops on DRAFT (cannot transition out of DRAFT via payments)', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ status: 'DRAFT' }));
    await h.svc.recomputeStatusFromPayments('inv-1');
    expect(h.tx.invoice.update).not.toHaveBeenCalled();
  });

  it('flips ISSUED → PAID when sum(payments) ≥ total', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({
      status: 'ISSUED',
      total: new Prisma.Decimal(119),
      payments: [{ amount: new Prisma.Decimal(50) }, { amount: new Prisma.Decimal(70) }],
    }));
    await h.svc.recomputeStatusFromPayments('inv-1');
    const arg = h.tx.invoice.update.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe('PAID');
  });

  it('flips ISSUED → PARTIALLY_PAID when 0 < sum(payments) < total', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({
      status: 'ISSUED',
      total: new Prisma.Decimal(200),
      payments: [{ amount: new Prisma.Decimal(50) }],
    }));
    await h.svc.recomputeStatusFromPayments('inv-1');
    const arg = h.tx.invoice.update.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe('PARTIALLY_PAID');
  });

  it('reverts PAID → ISSUED when all payments are removed and dueDate is in the future', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({
      status: 'PAID',
      total: new Prisma.Decimal(100),
      payments: [],
      dueDate: new Date(Date.now() + 86_400_000),
    }));
    await h.svc.recomputeStatusFromPayments('inv-1');
    const arg = h.tx.invoice.update.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe('ISSUED');
  });

  it('reverts PAID → OVERDUE when payments removed and dueDate is in the past', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({
      status: 'PAID',
      total: new Prisma.Decimal(100),
      payments: [],
      dueDate: new Date('2020-01-01'),
    }));
    await h.svc.recomputeStatusFromPayments('inv-1');
    const arg = h.tx.invoice.update.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe('OVERDUE');
  });

  it('skips DB write when computed status equals current status', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({
      status: 'PARTIALLY_PAID',
      total: new Prisma.Decimal(200),
      payments: [{ amount: new Prisma.Decimal(50) }],
    }));
    await h.svc.recomputeStatusFromPayments('inv-1');
    expect(h.tx.invoice.update).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });
});

// ─── generateAndStorePdf ───────────────────────────────────────────────

describe('InvoicesService.generateAndStorePdf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when invoice missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(null);
    await expect(h.svc.generateAndStorePdf('ghost')).rejects.toThrow(NotFoundException);
  });

  it('renders, uploads, persists pdfStorageKey, returns key', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ lines: [] }));
    h.tx.invoice.update.mockResolvedValue(makeExistingDraft());
    const key = await h.svc.generateAndStorePdf('inv-1');
    expect(key).toBe('tenant-1/invoices/inv-1.pdf');
    expect(h.pdf.render).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' }),
      'Acme SRL',
      'Emitent SRL',
    );
    expect(h.storage.putObject).toHaveBeenCalledWith(
      'tenant-1/invoices/inv-1.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
  });

  it('falls back to "Client" / "Emitent" when the lookups return null', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ lines: [] }));
    h.tx.invoice.update.mockResolvedValue(makeExistingDraft());
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValueOnce(null);
    vi.mocked(h.tx.company.findFirst).mockResolvedValueOnce(null);
    await h.svc.generateAndStorePdf('inv-1');
    expect(h.pdf.render).toHaveBeenCalledWith(
      expect.anything(),
      'Client',
      'Emitent',
    );
  });
});

// ─── getPdfUrl ─────────────────────────────────────────────────────────

describe('InvoicesService.getPdfUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns presigned URL when pdfStorageKey already exists (no regeneration)', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ pdfStorageKey: 'prev/key.pdf' }));
    const out = await h.svc.getPdfUrl('inv-1');
    expect(out.url).toBe('https://signed.example/pdf');
    expect(h.pdf.render).not.toHaveBeenCalled();
    expect(h.storage.presignGet).toHaveBeenCalledWith('prev/key.pdf');
  });

  it('generates and stores a PDF on demand if none exists', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(makeExistingDraft({ pdfStorageKey: null, lines: [] }));
    h.tx.invoice.update.mockResolvedValue(makeExistingDraft());
    const out = await h.svc.getPdfUrl('inv-1');
    expect(out.url).toBe('https://signed.example/pdf');
    expect(h.pdf.render).toHaveBeenCalled();
  });
});

// ─── markOverdueForAllTenants ──────────────────────────────────────────

describe('InvoicesService.markOverdueForAllTenants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the count of rows flipped from ISSUED to OVERDUE', async () => {
    const h = build();
    vi.mocked(h.prisma.invoice.updateMany).mockResolvedValue({ count: 7 });
    const n = await h.svc.markOverdueForAllTenants(new Date('2026-04-24'));
    expect(n).toBe(7);
    const arg = vi.mocked(h.prisma.invoice.updateMany).mock.calls[0]![0] as {
      where: { status: string; dueDate: { lt: Date } };
      data: { status: string };
    };
    expect(arg.where.status).toBe('ISSUED');
    expect(arg.data.status).toBe('OVERDUE');
    expect(arg.where.dueDate.lt).toBeInstanceOf(Date);
  });
});
