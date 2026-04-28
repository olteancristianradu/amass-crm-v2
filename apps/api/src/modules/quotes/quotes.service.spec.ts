import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QuotesService } from './quotes.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

type Mock = ReturnType<typeof vi.fn>;

function buildSvc(stubs: {
  next?: number; // for nextNumber's MAX query
  approvalNeeded?: boolean;
} = {}) {
  const tx = {
    quote: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    invoice: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };

  const runWithTenant: Mock = vi.fn(async (_t: string, cbOrMode: unknown, maybeCb?: unknown) => {
    const cb = typeof cbOrMode === 'function' ? cbOrMode : maybeCb;
    return (cb as (t: typeof tx) => Promise<unknown>)(tx);
  });

  // QuotesService.create + convertToInvoice use prisma.$queryRaw OUTSIDE
  // runWithTenant for nextNumber generation. Stub it on the prisma object.
  const queryRawDirect = vi.fn().mockResolvedValue([
    { max: stubs.next != null ? `OF-${new Date().getFullYear()}-${String(stubs.next - 1).padStart(3, '0')}` : null },
  ]);

  const prisma = {
    runWithTenant,
    $queryRaw: queryRawDirect,
  } as unknown as import('../../infra/prisma/prisma.service').PrismaService;

  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as import('../activities/activities.service').ActivitiesService;
  const approvals = {
    checkAndRequestApproval: vi.fn().mockResolvedValue(stubs.approvalNeeded ?? false),
  } as unknown as import('../approvals/approvals.service').ApprovalsService;

  const svc = new QuotesService(prisma, activities, approvals);
  return { svc, tx, runWithTenant, prisma, activities, approvals, queryRawDirect };
}

const sampleLine = {
  description: 'Widget',
  quantity: '2',
  unitPrice: '100',
  vatRate: '19',
};

describe('QuotesService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes per-line + aggregate totals server-side and writes activity', async () => {
    const h = buildSvc({ next: 1 });
    h.tx.quote.create.mockResolvedValueOnce({
      id: 'q1',
      companyId: 'co1',
      number: 'OF-2026-001',
      lines: [],
    });

    await h.svc.create({
      companyId: 'co1',
      title: 'Test quote',
      issueDate: new Date('2026-01-01'),
      validUntil: new Date('2026-02-01'),
      currency: 'RON',
      lines: [sampleLine, sampleLine],
    } as never);

    const callData = h.tx.quote.create.mock.calls[0][0].data;
    // 2 widgets × 100 = 200; VAT 19% = 38; total 238. Two lines → 476.
    expect(callData.subtotal.toString()).toBe('400');
    expect(callData.vatAmount.toString()).toBe('76');
    expect(callData.total.toString()).toBe('476');
    expect(callData.tenantId).toBe('tenant-1');
    expect(callData.createdById).toBe('user-1');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.created', subjectId: 'co1' }),
    );
  });

  it('generates OF-YYYY-001 for the first quote of the year', async () => {
    const h = buildSvc({ next: 1 });
    h.tx.quote.create.mockResolvedValueOnce({ id: 'q1', companyId: 'co1', number: '', lines: [] });
    await h.svc.create({
      companyId: 'co1',
      title: 'T',
      issueDate: new Date(),
      validUntil: new Date(),
      currency: 'RON',
      lines: [sampleLine],
    } as never);
    const num = h.tx.quote.create.mock.calls[0][0].data.number;
    expect(num).toMatch(/^OF-\d{4}-001$/);
  });

  it('increments the sequence when prior quotes exist', async () => {
    // Stub MAX = 'OF-2026-007' → next should be 008
    const h = buildSvc();
    (h.queryRawDirect as Mock).mockResolvedValueOnce([{ max: 'OF-2026-007' }]);
    h.tx.quote.create.mockResolvedValueOnce({ id: 'q1', companyId: 'co1', number: '', lines: [] });

    await h.svc.create({
      companyId: 'co1',
      title: 'T',
      issueDate: new Date(),
      validUntil: new Date(),
      currency: 'RON',
      lines: [sampleLine],
    } as never);

    const num = h.tx.quote.create.mock.calls[0][0].data.number;
    expect(num).toBe('OF-2026-008');
  });
});

describe('QuotesService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters by tenant + soft-deleted, plus optional status/companyId/dealId', async () => {
    const h = buildSvc();
    h.tx.quote.findMany.mockResolvedValueOnce([]);
    await h.svc.list({ companyId: 'c1', dealId: 'd1', status: 'SENT', limit: 20 } as never);
    const where = h.tx.quote.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      deletedAt: null,
      companyId: 'c1',
      dealId: 'd1',
      status: 'SENT',
    });
  });

  it('passes cursor + skip when cursor is provided', async () => {
    const h = buildSvc();
    h.tx.quote.findMany.mockResolvedValueOnce([]);
    await h.svc.list({ cursor: 'cursor-x', limit: 10 } as never);
    const args = h.tx.quote.findMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: 'cursor-x' });
    expect(args.skip).toBe(1);
  });
});

describe('QuotesService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound (with QUOTE_NOT_FOUND code) when missing', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the quote with ordered lines when found', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', lines: [{ position: 0 }] });
    const out = await h.svc.findOne('q1');
    expect(out.id).toBe('q1');
  });
});

describe('QuotesService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects update when quote is not DRAFT', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'SENT', lines: [] });
    await expect(
      h.svc.update('q1', { title: 'New title' } as never),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'QUOTE_NOT_EDITABLE' }),
    });
  });

  it('recomputes totals when lines change', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'DRAFT', lines: [] });
    h.tx.quote.update.mockResolvedValueOnce({ id: 'q1', lines: [] });

    await h.svc.update('q1', {
      lines: [{ ...sampleLine, quantity: '3' }],
    } as never);

    const data = h.tx.quote.update.mock.calls[0][0].data;
    // 3 × 100 = 300; VAT 19% = 57; total 357.
    expect(data.subtotal.toString()).toBe('300');
    expect(data.total.toString()).toBe('357');
    expect(data.lines.deleteMany).toEqual({ quoteId: 'q1' });
  });

  it('only patches scalar fields when lines are not provided', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'DRAFT', lines: [] });
    h.tx.quote.update.mockResolvedValueOnce({ id: 'q1', lines: [] });

    await h.svc.update('q1', { title: 'Renamed' } as never);
    const data = h.tx.quote.update.mock.calls[0][0].data;
    expect(data.title).toBe('Renamed');
    expect(data.lines).toBeUndefined();
    expect(data.subtotal).toBeUndefined();
  });
});

describe('QuotesService.changeStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects illegal transitions (DRAFT → ACCEPTED)', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'DRAFT', companyId: 'co1', total: new Prisma.Decimal('100'), currency: 'RON', lines: [] });
    await expect(
      h.svc.changeStatus('q1', { status: 'ACCEPTED' } as never),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_QUOTE_TRANSITION' }),
    });
  });

  it('routes DRAFT → SENT through the approval policy when threshold is hit', async () => {
    const h = buildSvc({ approvalNeeded: true });
    h.tx.quote.findFirst.mockResolvedValueOnce({
      id: 'q1',
      status: 'DRAFT',
      companyId: 'co1',
      total: new Prisma.Decimal('50000'),
      currency: 'RON',
      lines: [],
    });
    h.tx.quote.update.mockResolvedValueOnce({ id: 'q1', status: 'PENDING_APPROVAL' });

    await h.svc.changeStatus('q1', { status: 'SENT' } as never);

    expect(h.approvals.checkAndRequestApproval).toHaveBeenCalledWith(
      'q1',
      expect.anything(),
      'RON',
    );
    expect(h.tx.quote.update.mock.calls[0][0].data.status).toBe('PENDING_APPROVAL');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.pending_approval' }),
    );
  });

  it('lets DRAFT → SENT through directly when no approval is needed', async () => {
    const h = buildSvc({ approvalNeeded: false });
    h.tx.quote.findFirst.mockResolvedValueOnce({
      id: 'q1',
      status: 'DRAFT',
      companyId: 'co1',
      total: new Prisma.Decimal('100'),
      currency: 'RON',
      lines: [],
    });
    h.tx.quote.update.mockResolvedValueOnce({ id: 'q1', status: 'SENT' });

    await h.svc.changeStatus('q1', { status: 'SENT' } as never);

    expect(h.tx.quote.update.mock.calls[0][0].data.status).toBe('SENT');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.status_changed' }),
    );
  });

  it('allows SENT → ACCEPTED', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({
      id: 'q1',
      status: 'SENT',
      companyId: 'co1',
      total: new Prisma.Decimal('100'),
      currency: 'RON',
      lines: [],
    });
    h.tx.quote.update.mockResolvedValueOnce({ id: 'q1', status: 'ACCEPTED' });

    await h.svc.changeStatus('q1', { status: 'ACCEPTED' } as never);
    expect(h.tx.quote.update.mock.calls[0][0].data.status).toBe('ACCEPTED');
  });
});

describe('QuotesService.convertToInvoice', () => {
  beforeEach(() => vi.clearAllMocks());

  function acceptedQuote() {
    return {
      id: 'q1',
      companyId: 'co1',
      status: 'ACCEPTED' as const,
      invoiceId: null,
      currency: 'RON',
      notes: null,
      subtotal: new Prisma.Decimal('100'),
      vatAmount: new Prisma.Decimal('19'),
      total: new Prisma.Decimal('119'),
      dealId: null,
      lines: [{
        position: 0,
        description: 'Widget',
        quantity: new Prisma.Decimal('1'),
        unitPrice: new Prisma.Decimal('100'),
        vatRate: new Prisma.Decimal('19'),
        subtotal: new Prisma.Decimal('100'),
        vatAmount: new Prisma.Decimal('19'),
        total: new Prisma.Decimal('119'),
      }],
    };
  }

  it('rejects conversion when quote is not ACCEPTED', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ ...acceptedQuote(), status: 'SENT' });
    await expect(
      h.svc.convertToInvoice('q1', { series: 'A', issueDate: new Date(), dueDate: new Date() } as never),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'QUOTE_NOT_ACCEPTED' }),
    });
  });

  it('rejects double-conversion (quote already linked to an invoice)', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ ...acceptedQuote(), invoiceId: 'inv-existing' });
    await expect(
      h.svc.convertToInvoice('q1', { series: 'A', issueDate: new Date(), dueDate: new Date() } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('issues an invoice with locked-series next number and links the quote', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce(acceptedQuote());
    // Inside the tx, $queryRaw returns the current MAX → service adds +1.
    h.tx.$queryRaw.mockResolvedValueOnce([{ max: 41 }]);
    h.tx.invoice.create.mockResolvedValueOnce({ id: 'inv-1' });
    h.tx.quote.update.mockResolvedValueOnce({});

    const out = await h.svc.convertToInvoice('q1', {
      series: 'A',
      issueDate: new Date('2026-04-28'),
      dueDate: new Date('2026-05-28'),
    } as never);

    expect(out.invoiceId).toBe('inv-1');
    const invoiceData = h.tx.invoice.create.mock.calls[0][0].data;
    expect(invoiceData.number).toBe(42);
    expect(invoiceData.series).toBe('A');
    expect(invoiceData.companyId).toBe('co1');
    // Quote got linked to the invoice
    expect(h.tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q1' },
        data: { invoiceId: 'inv-1' },
      }),
    );
    // Activity logged
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.converted' }),
    );
  });

  it('starts at 1 when the series has no prior invoice', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce(acceptedQuote());
    h.tx.$queryRaw.mockResolvedValueOnce([{ max: null }]);
    h.tx.invoice.create.mockResolvedValueOnce({ id: 'inv-2' });
    h.tx.quote.update.mockResolvedValueOnce({});

    await h.svc.convertToInvoice('q1', {
      series: 'B',
      issueDate: new Date(),
      dueDate: new Date(),
    } as never);

    expect(h.tx.invoice.create.mock.calls[0][0].data.number).toBe(1);
  });
});

describe('QuotesService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects delete on SENT/ACCEPTED quotes', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'ACCEPTED', lines: [] });
    await expect(h.svc.remove('q1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'QUOTE_NOT_DELETABLE' }),
    });
  });

  it('soft-deletes DRAFT quotes', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'DRAFT', lines: [] });
    h.tx.quote.update.mockResolvedValueOnce({});

    await h.svc.remove('q1');
    expect(h.tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('soft-deletes EXPIRED quotes too', async () => {
    const h = buildSvc();
    h.tx.quote.findFirst.mockResolvedValueOnce({ id: 'q1', status: 'EXPIRED', lines: [] });
    h.tx.quote.update.mockResolvedValueOnce({});

    await h.svc.remove('q1');
    expect(h.tx.quote.update).toHaveBeenCalled();
  });
});
