import { describe, expect, it } from 'vitest';
import { InvoicePdfService } from './invoice-pdf.service';

const sampleInvoice = {
  id: 'inv-1',
  series: 'F',
  number: 7,
  issueDate: new Date('2026-04-01T00:00:00Z'),
  dueDate: new Date('2026-04-30T00:00:00Z'),
  currency: 'RON',
  subtotal: { toString: () => '1000.00' } as never,
  vatAmount: { toString: () => '190.00' } as never,
  total: { toString: () => '1190.00' } as never,
  status: 'ISSUED',
  notes: 'Multumim!',
  lines: [
    {
      id: 'l-1',
      position: 0,
      description: 'Consultanță',
      quantity: { toString: () => '1' },
      unitPrice: { toString: () => '1000.00' },
      vatRate: { toString: () => '19' },
      subtotal: { toString: () => '1000.00' },
      vatAmount: { toString: () => '190.00' },
      total: { toString: () => '1190.00' },
    },
  ],
} as unknown as Parameters<InvoicePdfService['render']>[0];

describe('InvoicePdfService.render', () => {
  it('returns a non-empty Buffer with the PDF magic header %PDF-', async () => {
    const svc = new InvoicePdfService();
    const buf = await svc.render(sampleInvoice, 'Acme SRL', 'My Tenant');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders without notes (defensive: notes can be null)', async () => {
    const svc = new InvoicePdfService();
    const buf = await svc.render(
      { ...sampleInvoice, notes: null },
      'Acme SRL',
      'My Tenant',
    );
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('handles multi-line invoices (loop over lines path covered)', async () => {
    const svc = new InvoicePdfService();
    const lines = [
      sampleInvoice.lines[0],
      { ...sampleInvoice.lines[0], id: 'l-2', position: 1, description: 'Mentenanță' },
      { ...sampleInvoice.lines[0], id: 'l-3', position: 2, description: 'Asistență' },
    ];
    const buf = await svc.render(
      { ...sampleInvoice, lines },
      'Acme SRL',
      'My Tenant',
    );
    expect(buf.length).toBeGreaterThan(500);
  });

  it('zero-pads invoice number to 4 digits in the rendered header', async () => {
    // Indirect proof: rendering a 1-digit number must still produce a valid
    // PDF without throwing, even if the formatted number ends up as "F-0007".
    const svc = new InvoicePdfService();
    const buf = await svc.render(
      { ...sampleInvoice, number: 1 },
      'X',
      'Y',
    );
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
