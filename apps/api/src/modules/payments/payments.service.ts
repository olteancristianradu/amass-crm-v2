import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import { CreatePaymentDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';

/**
 * S24 PaymentsService — records a payment against an invoice and kicks
 * InvoicesService.recomputeStatusFromPayments so the invoice FSM advances
 * to PARTIALLY_PAID / PAID automatically.
 *
 * Not a full ledger: no currency conversion, no reconciliation with bank
 * statements. A payment is a single row tied 1:1 to an Invoice.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(invoiceId: string): Promise<Payment[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.payment.findMany({
        where: { invoiceId, tenantId: ctx.tenantId, deletedAt: null },
        orderBy: { paidAt: 'desc' },
      }),
    );
  }

  async create(invoiceId: string, dto: CreatePaymentDto): Promise<Payment> {
    const ctx = requireTenantContext();
    const invoice = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!invoice) {
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' });
    }
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
      throw new BadRequestException({
        code: 'INVOICE_NOT_PAYABLE',
        message: `Cannot record payment on ${invoice.status} invoice`,
      });
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: 'PAYMENT_AMOUNT_INVALID',
        message: 'Payment amount must be positive',
      });
    }

    const payment = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.payment.create({
        data: {
          tenantId: ctx.tenantId,
          invoiceId,
          amount,
          paidAt: dto.paidAt,
          method: dto.method,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          createdById: ctx.userId ?? null,
        },
      }),
    );

    await this.invoices.recomputeStatusFromPayments(invoiceId);

    await this.audit.log({
      action: 'payment.create',
      subjectType: 'payment',
      subjectId: payment.id,
      metadata: { invoiceId, amount: amount.toString(), method: dto.method },
    });
    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: invoice.companyId,
      action: 'payment.recorded',
      metadata: {
        invoiceId,
        paymentId: payment.id,
        amount: amount.toString(),
        number: `${invoice.series}-${invoice.number}`,
      },
    });
    return payment;
  }

  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const payment = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.payment.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!payment) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' });
    }
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.payment.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.invoices.recomputeStatusFromPayments(payment.invoiceId);
    await this.audit.log({
      action: 'payment.delete',
      subjectType: 'payment',
      subjectId: id,
      metadata: { invoiceId: payment.invoiceId, amount: payment.amount.toString() },
    });
  }

  /**
   * Batch-mark ISSUED invoices past dueDate as OVERDUE. Called by the
   * scheduler; idempotent — already-OVERDUE invoices stay put. We skip
   * PARTIALLY_PAID/PAID because the recompute path handles those.
   */
  async markOverdueInvoices(tenantId: string, now: Date = new Date()): Promise<number> {
    const res = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.invoice.updateMany({
        where: {
          tenantId,
          status: 'ISSUED',
          dueDate: { lt: now },
          deletedAt: null,
        },
        data: { status: 'OVERDUE' },
      }),
    );
    return res.count;
  }
}
