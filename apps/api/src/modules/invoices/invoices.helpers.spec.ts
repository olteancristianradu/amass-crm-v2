import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertTransition, computeLine, sumLines, round2 } from './invoices.helpers';

describe('computeLine', () => {
  it('computes subtotal, vat, and total with 19% TVA', () => {
    const line = computeLine(
      { description: 'Widget', quantity: '3', unitPrice: '100', vatRate: '19' },
      0,
    );
    expect(line.subtotal.toString()).toBe('300');
    expect(line.vatAmount.toString()).toBe('57');
    expect(line.total.toString()).toBe('357');
  });

  it('rounds to 2 decimals (no float drift)', () => {
    // 7 * 3.33 = 23.31, vat 19% = 4.4289 → rounded to 4.43
    const line = computeLine(
      { description: 'x', quantity: '7', unitPrice: '3.33', vatRate: '19' },
      0,
    );
    expect(line.subtotal.toString()).toBe('23.31');
    expect(line.vatAmount.toString()).toBe('4.43');
    expect(line.total.toString()).toBe('27.74');
  });

  it('handles 0% VAT (reverse charge / export)', () => {
    const line = computeLine(
      { description: 'export', quantity: '1', unitPrice: '1000', vatRate: '0' },
      5,
    );
    expect(line.vatAmount.toString()).toBe('0');
    expect(line.total.toString()).toBe('1000');
    expect(line.position).toBe(5);
  });
});

describe('sumLines', () => {
  it('sums subtotal/vat/total across multiple lines', () => {
    const lines = [
      computeLine({ description: 'a', quantity: '1', unitPrice: '100', vatRate: '19' }, 0),
      computeLine({ description: 'b', quantity: '2', unitPrice: '50', vatRate: '19' }, 1),
    ];
    const sum = sumLines(lines);
    expect(sum.subtotal.toString()).toBe('200');
    expect(sum.vatAmount.toString()).toBe('38');
    expect(sum.total.toString()).toBe('238');
  });

  it('returns zero totals for empty input', () => {
    const sum = sumLines([]);
    expect(sum.subtotal.toString()).toBe('0');
    expect(sum.total.toString()).toBe('0');
  });
});

describe('round2', () => {
  it('half-up rounding (0.125 → 0.13)', () => {
    expect(round2(new Prisma.Decimal('0.125')).toString()).toBe('0.13');
  });
});

describe('assertTransition (invoice FSM)', () => {
  it('DRAFT → ISSUED is allowed', () => {
    expect(() => assertTransition('DRAFT', 'ISSUED')).not.toThrow();
  });

  it('DRAFT → PAID is NOT allowed (cannot skip ISSUED)', () => {
    expect(() => assertTransition('DRAFT', 'PAID')).toThrow(BadRequestException);
  });

  it('PAID → ISSUED is not allowed (cannot un-pay an invoice)', () => {
    expect(() => assertTransition('PAID', 'ISSUED')).toThrow(BadRequestException);
  });

  it('CANCELLED is a dead-end (no transitions out)', () => {
    expect(() => assertTransition('CANCELLED', 'DRAFT')).toThrow(BadRequestException);
    expect(() => assertTransition('CANCELLED', 'ISSUED')).toThrow(BadRequestException);
  });

  it('PAID → CANCELLED is allowed (e.g. storno)', () => {
    expect(() => assertTransition('PAID', 'CANCELLED')).not.toThrow();
  });

  it('OVERDUE → PAID catches up without stopping in PARTIALLY_PAID', () => {
    expect(() => assertTransition('OVERDUE', 'PAID')).not.toThrow();
  });

  it('from === to is a no-op (idempotent PATCH with same status)', () => {
    expect(() => assertTransition('ISSUED', 'ISSUED')).not.toThrow();
  });

  it('throws with the INVALID_STATUS_TRANSITION code for UI routing', () => {
    try {
      assertTransition('PAID', 'DRAFT');
    } catch (e) {
      const err = e as BadRequestException;
      const resp = err.getResponse() as { code: string };
      expect(resp.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });
});
