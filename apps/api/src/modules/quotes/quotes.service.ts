import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Quote, QuoteLine, QuoteStatus } from '@prisma/client';
import {
  ChangeQuoteStatusDto,
  ConvertQuoteToInvoiceDto,
  CreateQuoteDto,
  ListQuotesQueryDto,
  QuoteLineInputDto,
  UpdateQuoteDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CursorPage, makeCursorPage } from '../../common/pagination';

export type QuoteWithLines = Quote & { lines: QuoteLine[] };

/** Compute per-line totals server-side — clients never submit totals. */
function computeLine(l: QuoteLineInputDto, position: number) {
  const qty = new Prisma.Decimal(l.quantity);
  const unit = new Prisma.Decimal(l.unitPrice);
  const vat = new Prisma.Decimal(l.vatRate);
  const subtotal = qty.mul(unit).toDecimalPlaces(2);
  const vatAmount = subtotal.mul(vat).div(100).toDecimalPlaces(2);
  const total = subtotal.add(vatAmount);
  return { position, description: l.description, quantity: qty, unitPrice: unit, vatRate: vat, subtotal, vatAmount, total };
}

function sumLines(lines: ReturnType<typeof computeLine>[]) {
  return lines.reduce(
    (acc, l) => ({
      subtotal: acc.subtotal.add(l.subtotal),
      vatAmount: acc.vatAmount.add(l.vatAmount),
      total: acc.total.add(l.total),
    }),
    { subtotal: new Prisma.Decimal(0), vatAmount: new Prisma.Decimal(0), total: new Prisma.Decimal(0) },
  );
}

const STATUS_TRANSITIONS: Partial<Record<QuoteStatus, QuoteStatus[]>> = {
  DRAFT: ['SENT', 'PENDING_APPROVAL'],
  PENDING_APPROVAL: ['SENT', 'DRAFT'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
};

function assertTransition(from: QuoteStatus, to: QuoteStatus): void {
  const allowed = STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException({
      code: 'INVALID_QUOTE_TRANSITION',
      message: `Cannot transition from ${from} to ${to}`,
    });
  }
}

/** Generate next sequential number like "OF-2026-001" */
async function nextNumber(prisma: PrismaService, tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OF-${year}-`;
  const rows = await prisma.$queryRaw<[{ max: string | null }]>`
    SELECT MAX(number) AS max FROM quotes
    WHERE tenant_id = ${tenantId} AND number LIKE ${prefix + '%'}
  `;
  const last = rows[0]?.max;
  const seq = last ? parseInt(last.replace(prefix, ''), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
    private readonly approvals: ApprovalsService,
  ) {}

  async create(dto: CreateQuoteDto): Promise<QuoteWithLines> {
    const ctx = requireTenantContext();
    const lines = dto.lines.map((l, i) => computeLine(l, i));
    const totals = sumLines(lines);
    const number = await nextNumber(this.prisma, ctx.tenantId);

    const quote = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.quote.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: dto.companyId,
          dealId: dto.dealId ?? null,
          number,
          title: dto.title,
          issueDate: dto.issueDate,
          validUntil: dto.validUntil,
          currency: dto.currency as never,
          notes: dto.notes ?? null,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          createdById: ctx.userId ?? null,
          lines: {
            create: lines.map((l) => ({
              tenantId: ctx.tenantId,
              ...l,
            })),
          },
        },
        include: { lines: { orderBy: { position: 'asc' } } },
      }),
    );

    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: dto.companyId,
      action: 'quote.created',
      metadata: { quoteId: quote.id, number, total: totals.total.toString() },
    });

    return quote as QuoteWithLines;
  }

  async list(query: ListQuotesQueryDto): Promise<CursorPage<Quote>> {
    const ctx = requireTenantContext();
    const where: Prisma.QuoteWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.status ? { status: query.status as QuoteStatus } : {}),
    };
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.quote.findMany({
        where,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
        include: { lines: { orderBy: { position: 'asc' } } },
      }),
    );
    return makeCursorPage(items as Quote[], query.limit);
  }

  async findOne(id: string): Promise<QuoteWithLines> {
    const ctx = requireTenantContext();
    const q = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.quote.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: { lines: { orderBy: { position: 'asc' } } },
      }),
    );
    if (!q) throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Quote not found' });
    return q as QuoteWithLines;
  }

  async update(id: string, dto: UpdateQuoteDto): Promise<QuoteWithLines> {
    const ctx = requireTenantContext();
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException({ code: 'QUOTE_NOT_EDITABLE', message: 'Only DRAFT quotes can be edited' });
    }

    const lines = dto.lines ? dto.lines.map((l, i) => computeLine(l, i)) : null;
    const totals = lines ? sumLines(lines) : null;

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.quote.update({
        where: { id },
        data: {
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.issueDate ? { issueDate: dto.issueDate } : {}),
          ...(dto.validUntil ? { validUntil: dto.validUntil } : {}),
          ...(dto.currency ? { currency: dto.currency as never } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(totals
            ? {
                subtotal: totals.subtotal,
                vatAmount: totals.vatAmount,
                total: totals.total,
                lines: {
                  deleteMany: { quoteId: id },
                  create: lines!.map((l) => ({ tenantId: ctx.tenantId, ...l })),
                },
              }
            : {}),
        },
        include: { lines: { orderBy: { position: 'asc' } } },
      }),
    );
    return updated as QuoteWithLines;
  }

  async changeStatus(id: string, dto: ChangeQuoteStatusDto): Promise<Quote> {
    const ctx = requireTenantContext();
    const existing = await this.findOne(id);
    assertTransition(existing.status, dto.status as QuoteStatus);

    // When agent tries to SEND a DRAFT quote, check approval policies first
    if (existing.status === 'DRAFT' && dto.status === 'SENT') {
      const needsApproval = await this.approvals.checkAndRequestApproval(
        id,
        existing.total,
        existing.currency,
      );
      if (needsApproval) {
        const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
          tx.quote.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } }),
        );
        await this.activities.log({
          subjectType: 'COMPANY',
          subjectId: existing.companyId,
          action: 'quote.pending_approval',
          metadata: { quoteId: id },
        });
        return updated;
      }
    }

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.quote.update({ where: { id }, data: { status: dto.status as QuoteStatus } }),
    );

    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: existing.companyId,
      action: 'quote.status_changed',
      metadata: { quoteId: id, from: existing.status, to: dto.status },
    });

    return updated;
  }

  async convertToInvoice(id: string, dto: ConvertQuoteToInvoiceDto): Promise<{ invoiceId: string }> {
    const ctx = requireTenantContext();
    const quote = await this.findOne(id);

    if (quote.status !== 'ACCEPTED') {
      throw new BadRequestException({
        code: 'QUOTE_NOT_ACCEPTED',
        message: 'Only ACCEPTED quotes can be converted to invoices',
      });
    }
    if (quote.invoiceId) {
      throw new ConflictException({ code: 'QUOTE_ALREADY_CONVERTED', message: 'This quote was already converted' });
    }

    // Get next invoice number
    const [maxRow] = await this.prisma.$queryRaw<[{ max: number | null }]>`
      SELECT MAX(number) AS max FROM invoices
      WHERE tenant_id = ${ctx.tenantId} AND series = ${dto.series} AND deleted_at IS NULL
    `;
    const nextNum = (maxRow?.max ?? 0) + 1;

    const result = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: quote.companyId,
          dealId: quote.dealId ?? null,
          series: dto.series,
          number: nextNum,
          issueDate: dto.issueDate,
          dueDate: dto.dueDate,
          currency: quote.currency,
          notes: quote.notes,
          subtotal: quote.subtotal,
          vatAmount: quote.vatAmount,
          total: quote.total,
          createdById: ctx.userId ?? null,
          lines: {
            create: quote.lines.map((l) => ({
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
      });

      await tx.quote.update({
        where: { id },
        data: { invoiceId: invoice.id },
      });

      return invoice;
    });

    await this.activities.log({
      subjectType: 'COMPANY',
      subjectId: quote.companyId,
      action: 'quote.converted',
      metadata: { quoteId: id, invoiceId: result.id },
    });

    return { invoiceId: result.id };
  }

  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const existing = await this.findOne(id);
    if (!['DRAFT', 'REJECTED', 'EXPIRED'].includes(existing.status)) {
      throw new BadRequestException({ code: 'QUOTE_NOT_DELETABLE', message: 'Only DRAFT/REJECTED/EXPIRED quotes can be deleted' });
    }
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.quote.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}
