import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { InvoiceLineInputDto } from '@amass/shared';

/**
 * M-12 — pure helpers extracted from InvoicesService to keep the service
 * focused on orchestration. These functions have no DB or Nest dependencies
 * and can be unit-tested in isolation.
 */

export interface ComputedLine {
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
export function computeLine(l: InvoiceLineInputDto, position: number): ComputedLine {
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

export function sumLines(lines: ComputedLine[]): {
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
} {
  const subtotal = lines.reduce((acc, l) => acc.add(l.subtotal), new Prisma.Decimal(0));
  const vatAmount = lines.reduce((acc, l) => acc.add(l.vatAmount), new Prisma.Decimal(0));
  const total = lines.reduce((acc, l) => acc.add(l.total), new Prisma.Decimal(0));
  return { subtotal, vatAmount, total };
}

export function round2(d: Prisma.Decimal): Prisma.Decimal {
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

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestException({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot transition invoice from ${from} to ${to}`,
    });
  }
}
