import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    invoice: {
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    payment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof PaymentsService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof PaymentsService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof PaymentsService>[2];
  const invoices = {
    recomputeStatusFromPayments: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof PaymentsService>[3];
  return { svc: new PaymentsService(prisma, audit, activities, invoices), prisma, tx, audit, activities, invoices };
}

const goodInvoice = {
  id: 'inv-1', tenantId: 'tenant-1', status: 'ISSUED', companyId: 'company-1',
  series: 'AMS', number: 42,
};

describe('PaymentsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns payments scoped to invoice + tenant', async () => {
    const h = build();
    h.tx.payment.findMany.mockResolvedValue([{ id: 'p-1' }]);
    const out = await h.svc.list('inv-1');
    expect(out).toHaveLength(1);
    const arg = h.tx.payment.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({ invoiceId: 'inv-1', tenantId: 'tenant-1', deletedAt: null });
  });
});

describe('PaymentsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws INVOICE_NOT_FOUND when the invoice is missing', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(null);
    await expect(
      h.svc.create('ghost', { amount: '100', paidAt: new Date(), method: 'BANK_TRANSFER' } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws INVOICE_NOT_PAYABLE on DRAFT invoice', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue({ ...goodInvoice, status: 'DRAFT' });
    await expect(
      h.svc.create('inv-1', { amount: '100', paidAt: new Date(), method: 'BANK_TRANSFER' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws INVOICE_NOT_PAYABLE on CANCELLED invoice', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue({ ...goodInvoice, status: 'CANCELLED' });
    await expect(
      h.svc.create('inv-1', { amount: '100', paidAt: new Date(), method: 'BANK_TRANSFER' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects zero or negative amount', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(goodInvoice);
    await expect(
      h.svc.create('inv-1', { amount: '0', paidAt: new Date(), method: 'BANK_TRANSFER' } as never),
    ).rejects.toThrow(BadRequestException);
    await expect(
      h.svc.create('inv-1', { amount: '-50', paidAt: new Date(), method: 'BANK_TRANSFER' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('happy path: creates payment, triggers invoice recompute, audits + activity-logs', async () => {
    const h = build();
    h.tx.invoice.findFirst.mockResolvedValue(goodInvoice);
    h.tx.payment.create.mockResolvedValue({ id: 'p-1', amount: new Prisma.Decimal(100), invoiceId: 'inv-1' });
    await h.svc.create('inv-1', {
      amount: '100', paidAt: new Date('2026-04-01'), method: 'BANK_TRANSFER', reference: 'REF-1', notes: 'note',
    } as never);
    expect(h.tx.payment.create).toHaveBeenCalled();
    expect(h.invoices.recomputeStatusFromPayments).toHaveBeenCalledWith('inv-1');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.create' }),
    );
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'COMPANY', action: 'payment.recorded' }),
    );
  });
});

describe('PaymentsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws PAYMENT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.payment.findFirst.mockResolvedValue(null);
    await expect(h.svc.remove('ghost')).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes, recomputes invoice status, audits', async () => {
    const h = build();
    h.tx.payment.findFirst.mockResolvedValue({
      id: 'p-1', invoiceId: 'inv-1', amount: new Prisma.Decimal(100),
    });
    h.tx.payment.update.mockResolvedValue({ id: 'p-1' });
    await h.svc.remove('p-1');
    const updArg = h.tx.payment.update.mock.calls[0]![0] as { data: { deletedAt: Date } };
    expect(updArg.data.deletedAt).toBeInstanceOf(Date);
    expect(h.invoices.recomputeStatusFromPayments).toHaveBeenCalledWith('inv-1');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.delete' }),
    );
  });
});

describe('PaymentsService.markOverdueInvoices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips ISSUED invoices past dueDate to OVERDUE and returns count', async () => {
    const h = build();
    h.tx.invoice.updateMany.mockResolvedValue({ count: 5 });
    const n = await h.svc.markOverdueInvoices('tenant-1', new Date('2026-04-24'));
    expect(n).toBe(5);
    const arg = h.tx.invoice.updateMany.mock.calls[0]![0] as {
      where: { status: string; dueDate: { lt: Date } };
      data: { status: string };
    };
    expect(arg.where.status).toBe('ISSUED');
    expect(arg.data.status).toBe('OVERDUE');
    expect(arg.where.dueDate.lt).toBeInstanceOf(Date);
  });
});
