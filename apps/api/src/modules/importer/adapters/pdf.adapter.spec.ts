import { describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({
  // Minimal mock: returns whatever text we encoded into the fake buffer's
  // string content. Tests pass a Buffer.from(text) and the mock yields
  // that exact text back, plus numpages = 1.
  default: vi.fn(async (b: Buffer) => ({
    text: b.toString('utf8'),
    numpages: 1,
  })),
}));

import { PdfAdapter } from './pdf.adapter';

describe('PdfAdapter', () => {
  const adapter = new PdfAdapter();

  it('canHandle picks .pdf by extension', () => {
    expect(adapter.canHandle({ mimeType: 'application/pdf', fileName: 'invoice.pdf' })).toBe(true);
  });

  it('canHandle picks application/pdf mime', () => {
    expect(adapter.canHandle({ mimeType: 'application/pdf', fileName: 'no-ext' })).toBe(true);
  });

  it('canHandle rejects non-PDF', () => {
    expect(adapter.canHandle({ mimeType: 'text/csv', fileName: 'data.csv' })).toBe(false);
  });

  it('returns empty + warning when text is below threshold (scanned PDF)', async () => {
    const result = await adapter.parse(Buffer.from('short'));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/scanned image PDF.*OCR/i);
  });

  it('extracts Romanian invoice fields from text', async () => {
    const text = `
      Factura Nr. F2026-001
      Furnizor: ALFA TECH SRL
      CIF: RO12345678
      Client: Beta Construct SA
      Total: 1.234,56 RON
      Data: 2026-05-05
    `.repeat(2);
    const result = await adapter.parse(Buffer.from(text));
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row['CIF']).toBe('RO12345678');
    expect(row['Total']).toBe('1.234,56');
    expect(row['Currency']).toBe('RON');
    expect(row['Furnizor']).toContain('ALFA TECH');
    expect(row['Client']).toContain('Beta Construct');
    expect(row['InvoiceNumber']).toBe('F2026-001');
    expect(result.detectedLocale).toBe('ro');
  });

  it('extracts CNP when present', async () => {
    const text = `Document privat. CNP: 1234567890123. Restul textului are mai mult de 50 caractere ca să treacă pragul.`;
    const result = await adapter.parse(Buffer.from(text));
    expect(result.rows[0]!['CNP']).toBe('1234567890123');
  });

  it('warns when no structured fields recognized', async () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.';
    const result = await adapter.parse(Buffer.from(text));
    expect(result.warnings.join(' ')).toMatch(/No structured fields/);
    expect(result.rows[0]!['_pdf_text']).toBeDefined();
  });
});
