import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ExcelAdapter } from './excel.adapter';

async function buildWorkbook(rows: Array<Record<string, string | number>>, sheetName = 'Sheet1'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]!);
    ws.addRow(headers);
    for (const row of rows) {
      ws.addRow(headers.map((h) => row[h]));
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function buildMultiSheetWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Clienti');
  s1.addRow(['Nume', 'Email']);
  s1.addRow(['Popescu', 'p@test.ro']);
  const s2 = wb.addWorksheet('Produse');
  s2.addRow(['Produs', 'Pret']);
  s2.addRow(['X', 100]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('ExcelAdapter', () => {
  const adapter = new ExcelAdapter();

  it('parses a simple xlsx workbook with Romanian headers', async () => {
    const buffer = await buildWorkbook([
      { Nume: 'Popescu', Prenume: 'Ion', Email: 'ion@example.ro' },
      { Nume: 'Ionescu', Prenume: 'Maria', Email: 'maria@example.ro' },
    ]);
    const result = await adapter.parse(buffer);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ Nume: 'Popescu', Prenume: 'Ion' });
    expect(result.warnings).toEqual([]);
  });

  it('warns when the workbook has multiple sheets but only imports the first', async () => {
    const result = await adapter.parse(await buildMultiSheetWorkbook());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ Nume: 'Popescu' });
    expect(result.warnings.join(' ')).toMatch(/2 sheets.*only "Clienti".*Produse/);
  });

  it('returns empty rows array when workbook has only a header', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Header1', 'Header2']);
    const buf = await wb.xlsx.writeBuffer();
    const result = await adapter.parse(Buffer.from(buf));
    expect(result.rows).toEqual([]);
  });

  it('throws on a corrupt/non-Excel buffer', async () => {
    await expect(adapter.parse(Buffer.from('this is not an xlsx file'))).rejects.toThrow(
      /Failed to read Excel workbook/,
    );
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
    const buffer = await buildWorkbook([
      { Cell: '=SUM(A1:A10)', Other: 'normal' },
      { Cell: '+1+1', Other: 'also normal' },
    ]);
    const result = await adapter.parse(buffer);
    // sanitizeCsvRow prepends a single quote
    expect((result.rows[0] as { Cell: string }).Cell.startsWith("'")).toBe(true);
    expect((result.rows[1] as { Cell: string }).Cell.startsWith("'")).toBe(true);
  });
});
