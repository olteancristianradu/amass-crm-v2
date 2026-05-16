import { describe, expect, it, vi } from 'vitest';

// Vitest 4 no longer auto-wraps arrow functions as constructors —
// `new (() => {})()` throws. Use class syntax so `new PDFParse(...)`
// / `new GoogleGenerativeAI(...)` work like the production code.
vi.mock('pdf-parse', () => ({
  PDFParse: class PDFParse {
    constructor(private readonly opts: { data: Buffer }) {}
    async getText(): Promise<{ text: string; total: number }> {
      return { text: this.opts.data.toString('utf8'), total: 1 };
    }
  },
}));

// Mock Gemini SDK so the adapter doesn't make real API calls in tests.
// `OCR_MOCK_TEXT` lets each test set what the SDK pretends to return.
const OCR_MOCK = { text: '' as string, throw: false };
vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(): {
      generateContent: () => Promise<{ response: { text: () => string } }>;
    } {
      return {
        generateContent: async () => {
          if (OCR_MOCK.throw) throw new Error('mock OCR failure');
          return { response: { text: () => OCR_MOCK.text } };
        },
      };
    }
  }
  return { GoogleGenerativeAI };
});

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

  it('returns empty + warning when scanned PDF and OCR yields nothing', async () => {
    OCR_MOCK.text = '';
    OCR_MOCK.throw = false;
    delete process.env['GEMINI_API_KEY'];
    const result = await adapter.parse(Buffer.from('short'));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/extraction returned only.*GEMINI_API_KEY not set/);
  });

  it('uses Gemini vision OCR fallback when scanned PDF + GEMINI_API_KEY set', async () => {
    OCR_MOCK.text = `
      Factura Nr. F-2026-OCR
      Furnizor: OCR Recovered SRL
      CIF: RO99887766
      Total: 500,00 RON
    `.repeat(2);
    OCR_MOCK.throw = false;
    process.env['GEMINI_API_KEY'] = 'mock-key';
    const result = await adapter.parse(Buffer.from('img'));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!['CIF']).toBe('RO99887766');
    expect(result.warnings.join(' ')).toMatch(/Gemini vision OCR/i);
    delete process.env['GEMINI_API_KEY'];
  });

  it('falls back gracefully when Gemini OCR throws', async () => {
    OCR_MOCK.throw = true;
    process.env['GEMINI_API_KEY'] = 'mock-key';
    const result = await adapter.parse(Buffer.from('img'));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/OCR fallback yielded nothing/i);
    delete process.env['GEMINI_API_KEY'];
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
