import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invoice, InvoiceLine, InvoiceStatus, Prisma } from '@prisma/client';
import {
  ChangeInvoiceStatusDto,
  CreateInvoiceDto,
  InvoiceLineInputDto,
  ListInvoicesQueryDto,
  UpdateInvoiceDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { CursorPage, makeCursorPage } from '../../common/pagination';
import { InvoicePdfService } from './invoice-pdf.service';

/**
 * S22 InvoicesService.
 *
 * Invariants enforced server-side:
 *   - Line subtotals/vat/total are recomputed on every write. Clients cannot
 *     submit their own totals (prevents off-by-penny drift).
 *   - Invoice.subtotal / vatAmount / total = Σ lines. Recomputed on line change.
 *   - Number is auto-assigned if omitted: max(number)+1 per (tenantId, series).
 *   - Status transitions are validated in a small FSM (see assertTransition).
 *   - Only DRAFT invoices may have their lines/dates/currency mutated. ISSUED+
 *     invoices are effectively frozen — clients must CANCEL and re-issue.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly storage: StorageService,
    private readonly pdf: InvoicePdfService,
  ) {}

  async create(dto: CreateInvoiceDto): Promise<InvoiceWithLines> {
    const ctx = requireTenantContext();
    const lines = dto.lines.map((l, i) => computeLine(l, i));
    const totals = sumLines(lines);

    const number =
      dto.number ?? (await this.nextNumber(ctx.tenantId, dto.series));

    try {
      const invoice = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.invoice.create({
          data: {
            tenantId: ctx.tenantId,
            companyId: dto.companyId,
            dealId: dto.dealId ?? null,
            series: dto.series,
            number,
            issueDate: dto.issueDate,
            dueDate: dto.dueDate,
            currency: dto.currency,
            notes: dto.notes ?? null,
            subtotal: totals.subtotal,
            vatAmount: totals.vatAmount,
            total: totals.total,
            status: 'DRAFT',
            createdById: ctx.userId ?? null,
            lines: {
              create: lines.map((l) => ({
                tenantId: ctx.tenantId,
                position: l.position,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                vatRate: l.vatRate,
                subtotal: l.subtotal,
                vatAmount: l.vatAmount,
                total: l.total,
              })),
            },
          },
          include: { lines: { orderBy: { position: 'asc' } } },
        }),
      );

      await this.audit.log({
        action: 'invoice.create',
        subjectType: 'invoice',
        subjectId: invoice.id,
        metadata: { series: invoice.series, number: invoice.number, total: invoice.total.toString() },
      });
      await this.activities.log({
        subjectType: 'COMPANY',
        subjectId: invoice.companyId,
        action: 'invoice.created',
        metadata: { invoiceId: invoice.id, number: `${invoice.series}-${invoice.number}` },
      });
      return invoice;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'INVOICE_NUMBER_TAKEN',
          message: `Invoice ${dto.series}-${number} already exists`,
        });
      }
      throw err;
    }
  }

  async list(q: ListInvoicesQueryDto): Promise<CursorPage<Invoice>> {
    const ctx = requireTenantContext();
    const where: Prisma.InvoiceWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            issueDate: {
              ...(q.from ? { gte: q.from } : {}),
              ...(q.to ? { lte: q.to } : {}),
            },
          }
        : {}),
    };
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
      }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<InvoiceWithLines> {
    const ctx = requireTenantContext();
    const invoice = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: {
          lines: { orderBy: { position: 'asc' } },
          payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
        },
      }),
    );
    if (!invoice) {
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' });
    }
    return invoice;
  }

  async update(id: string, dto: UpdateInvoiceDto): Promise<InvoiceWithLines> {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException({
        code: 'INVOICE_NOT_EDITABLE',
        message: 'Only DRAFT invoices can be edited',
      });
    }
    const ctx = requireTenantContext();

    const data: Prisma.InvoiceUpdateInput = {
      ...(dto.issueDate !== undefined ? { issueDate: dto.issueDate } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    const updated = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      if (dto.lines) {
        // Full replacement of lines: wipe + recreate + recompute invoice totals.
        // Simpler than diffing positions and handles re-ordering automatically.
        const lines = dto.lines.map((l, i) => computeLine(l, i));
        const totals = sumLines(lines);
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id, tenantId: ctx.tenantId } });
        await tx.invoiceLine.createMany({
          data: lines.map((l) => ({
            tenantId: ctx.tenantId,
            invoiceId: id,
            position: l.position,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            subtotal: l.subtotal,
            vatAmount: l.vatAmount,
            total: l.total,
          })),
        });
        data.subtotal = totals.subtotal;
        data.vatAmount = totals.vatAmount;
        data.total = totals.total;
      }
      return tx.invoice.update({
        where: { id },
        data,
        include: {
          lines: { orderBy: { position: 'asc' } },
          payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
        },
      });
    });

    await this.audit.log({
      action: 'invoice.update',
      subjectType: 'invoice',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async changeStatus(id: string, dto: ChangeInvoiceStatusDto): Promise<Invoice> {
    const existing = await this.findOne(id);
    assertTransition(existing.status, dto.status);
    const ctx = requireTenantContext();

    // When moving DRAFT → ISSUED, freeze a PDF snapshot in MinIO. This is the
    // legally binding artifact the customer receives — we generate it ONCE
    // at issue time and never re-render, so edits to lines after issue
    // cannot retroactively change what the customer saw.
    let pdfKey: string | null = existing.pdfStorageKey;
    if (existing.status === 'DRAFT' && dto.status === 'ISSUED' && !pdfKey) {
      try {
        pdfKey = await this.generateAndStorePdf(id);
      } catch (err) {
        // Don't block the status transition on PDF failure — log and move on.
        // eslint-disable-next-line no-console
        console.error(`Invoice PDF generation failed for ${id}`, err);
      }
    }

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.update({
        where: { id },
        data: { status: dto.status, ...(pdfKey !== existing.pdfStorageKey ? { pdfStorageKey: pdfKey } : {}) },
      }),
    );
    await this.audit.log({
      action: 'invoice.status',
      subjectType: 'invoice',
      subjectId: id,
      metadata: { from: existing.status, to: dto.status },
    });
    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: existing.companyId,
      action: `invoice.${dto.status.toLowerCase()}`,
      metadata: { invoiceId: id, number: `${existing.series}-${existing.number}` },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT' && existing.status !== 'CANCELLED') {
      throw new BadRequestException({
        code: 'INVOICE_NOT_DELETABLE',
        message: 'Only DRAFT or CANCELLED invoices can be deleted',
      });
    }
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'invoice.delete',
      subjectType: 'invoice',
      subjectId: id,
      metadata: { number: `${existing.series}-${existing.number}` },
    });
  }

  /**
   * Recompute invoice status from its payments.
   * Called by PaymentsService after create/delete. Public so the S24 module
   * can reach in without recomputing manually.
   *   total paid ≥ total          → PAID
   *   0 < total paid < total      → PARTIALLY_PAID
   *   total paid == 0             → ISSUED (unless already OVERDUE/CANCELLED)
   */
  async recomputeStatusFromPayments(invoiceId: string): Promise<void> {
    const ctx = requireTenantContext();
    const invoice = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, tenantId: ctx.tenantId, deletedAt: null },
        include: { payments: { where: { deletedAt: null } } },
      }),
    );
    if (!invoice) return;
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') return;

    const paid = invoice.payments.reduce(
      (sum, p) => sum.add(p.amount),
      new Prisma.Decimal(0),
    );
    let next: InvoiceStatus = invoice.status;
    if (paid.gte(invoice.total)) next = 'PAID';
    else if (paid.gt(0)) next = 'PARTIALLY_PAID';
    else if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      // All payments were deleted — revert to ISSUED (or OVERDUE if past due).
      next = invoice.dueDate < new Date() ? 'OVERDUE' : 'ISSUED';
    }

    if (next !== invoice.status) {
      await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.invoice.update({ where: { id: invoiceId }, data: { status: next } }),
      );
      await this.audit.log({
        action: 'invoice.status',
        subjectType: 'invoice',
        subjectId: invoiceId,
        metadata: { from: invoice.status, to: next, reason: 'payment-recompute' },
      });
    }
  }

  /**
   * Render the invoice to PDF + upload to MinIO. Returns the storage key.
   * Idempotent-ish: if a PDF already exists for this invoice we overwrite it.
   * Object key shape: <tenantId>/invoices/<id>.pdf — keeps tenant isolation
   * on the storage layer too.
   */
  async generateAndStorePdf(invoiceId: string): Promise<string> {
    const ctx = requireTenantContext();
    const invoice = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, tenantId: ctx.tenantId, deletedAt: null },
        include: { lines: { orderBy: { position: 'asc' } } },
      }),
    );
    if (!invoice) {
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' });
    }
    const [tenant, company] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: ctx.tenantId } }),
      this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.company.findFirst({ where: { id: invoice.companyId, tenantId: ctx.tenantId } }),
      ),
    ]);
    const buf = await this.pdf.render(
      invoice,
      company?.name ?? 'Client',
      tenant?.name ?? 'Emitent',
    );
    const key = `${ctx.tenantId}/invoices/${invoice.id}.pdf`;
    await this.storage.putObject(key, buf, 'application/pdf');
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.invoice.update({ where: { id: invoice.id }, data: { pdfStorageKey: key } }),
    );
    return key;
  }

  /** Presigned GET URL for the PDF (15-min TTL). Generates the PDF on demand if missing. */
  async getPdfUrl(invoiceId: string): Promise<{ url: string }> {
    const invoice = await this.findOne(invoiceId);
    const key = invoice.pdfStorageKey ?? (await this.generateAndStorePdf(invoiceId));
    const url = await this.storage.presignGet(key);
    return { url };
  }

  /**
   * Cron-called sweep: flip ISSUED → OVERDUE when dueDate has passed.
   * Runs across all tenants at once via raw UPDATE (bypasses RLS — this
   * is a privileged service-level job, not a user-initiated action).
   * Same approach as GdprService.sweepAllTenants.
   */
  async markOverdueForAllTenants(now: Date = new Date()): Promise<number> {
    const res = await this.prisma.invoice.updateMany({
      where: {
        status: 'ISSUED',
        dueDate: { lt: now },
        deletedAt: null,
      },
      data: { status: 'OVERDUE' },
    });
    return res.count;
  }

  private async nextNumber(tenantId: string, series: string): Promise<number> {
    const row = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.invoice.aggregate({
        where: { tenantId, series },
        _max: { number: true },
      }),
    );
    return (row._max.number ?? 0) + 1;
  }
}

export type InvoiceWithLines = Invoice & { lines: InvoiceLine[] };

interface ComputedLine {
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Turn a DTO line into a fully-costed row. All monetary values are stored
 * as Decimal to avoid float drift — subtotal is rounded to 2dp before VAT
 * is applied so the numbers match what the customer sees on the PDF.
 */
function computeLine(l: InvoiceLineInputDto, position: number): ComputedLine {
  const quantity = new Prisma.Decimal(l.quantity);
  const unitPrice = new Prisma.Decimal(l.unitPrice);
  const vatRate = new Prisma.Decimal(l.vatRate);
  const subtotal = round2(quantity.mul(unitPrice));
  const vatAmount = round2(subtotal.mul(vatRate).div(100));
  const total = round2(subtotal.add(vatAmount));
  return {
    position,
    description: l.description,
    quantity,
    unitPrice,
    vatRate,
    subtotal,
    vatAmount,
    total,
  };
}

function sumLines(lines: ComputedLine[]): {
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
} {
  const subtotal = lines.reduce((acc, l) => acc.add(l.subtotal), new Prisma.Decimal(0));
  const vatAmount = lines.reduce((acc, l) => acc.add(l.vatAmount), new Prisma.Decimal(0));
  const total = lines.reduce((acc, l) => acc.add(l.total), new Prisma.Decimal(0));
  return { subtotal, vatAmount, total };
}

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'CANCELLED'],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  PAID: ['CANCELLED'],
  CANCELLED: [],
};

function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestException({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot transition invoice from ${from} to ${to}`,
    });
  }
}
