import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { ExcelAdapter } from './excel.adapter';

function buildWorkbook(rows: Array<Record<string, unknown>>, sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildMultiSheetWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Nume: 'Popescu', Email: 'p@test.ro' }]),
    'Clienti',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Produs: 'X', Pret: '100' }]),
    'Produse',
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('ExcelAdapter', () => {
  const adapter = new ExcelAdapter();

  it('parses a simple xlsx workbook with Romanian headers', async () => {
    const buffer = buildWorkbook([
      { Nume: 'Popescu', Prenume: 'Ion', Email: 'ion@example.ro' },
      { Nume: 'Ionescu', Prenume: 'Maria', Email: 'maria@example.ro' },
    ]);
    const result = await adapter.parse(buffer);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ Nume: 'Popescu', Prenume: 'Ion' });
    expect(result.warnings).toEqual([]);
  });

  it('warns when the workbook has multiple sheets but only imports the first', async () => {
    const result = await adapter.parse(buildMultiSheetWorkbook());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ Nume: 'Popescu' });
    expect(result.warnings.join(' ')).toMatch(/2 sheets.*only "Clienti".*Produse/);
  });

  it('returns empty rows array (no throw) when workbook is empty', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Empty');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const result = await adapter.parse(buffer);
    expect(result.rows).toEqual([]);
  });

  it('returns empty rows for a non-Excel buffer that SheetJS still parses as empty', async () => {
    // SheetJS is lenient — it tries multiple format detections and may
    // return an empty-but-valid workbook for garbage input. We accept
    // either an empty result or a thrown error.
    try {
      const result = await adapter.parse(Buffer.from('this is not an xlsx file'));
      expect(result.rows).toEqual([]);
    } catch (err) {
      expect((err as Error).message).toMatch(/Excel workbook|sheet/i);
    }
  });

  it('canHandle picks .xlsx by extension', () => {
    expect(
      adapter.canHandle({
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'export.xlsx',
      }),
    ).toBe(true);
  });

  it('canHandle picks .xls by extension', () => {
    expect(adapter.canHandle({ mimeType: 'application/vnd.ms-excel', fileName: 'old.xls' })).toBe(true);
  });

  it('canHandle rejects unrelated formats', () => {
    expect(adapter.canHandle({ mimeType: 'application/pdf', fileName: 'doc.pdf' })).toBe(false);
  });

  it('sanitizes formula-injection cells (leading =, +, -, @)', async () => {
    const buffer = buildWorkbook([
      { Cell: '=SUM(A1:A10)', Other: 'normal' },
      { Cell: '+1+1', Other: 'also normal' },
    ]);
    const result = await adapter.parse(buffer);
    // sanitizeCsvRow prepends a single quote
    expect((result.rows[0] as { Cell: string }).Cell.startsWith("'")).toBe(true);
    expect((result.rows[1] as { Cell: string }).Cell.startsWith("'")).toBe(true);
  });
});
