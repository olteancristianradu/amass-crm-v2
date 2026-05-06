import ExcelJS from 'exceljs';
import { sanitizeCsvRow } from '../../../common/utils/csv-safe';
import type { ImporterAdapter, ParseResult, RawRow } from './types';

/**
 * Excel (.xlsx, .xls, .xlsm) adapter using ExcelJS.
 *
 * We use ExcelJS instead of SheetJS (xlsx) because xlsx@0.18.5 on npm
 * has unfixed HIGH advisories (proto-pollution + ReDoS) — the patched
 * SheetJS releases are not on npm. ExcelJS is MIT-licensed, actively
 * maintained, and CVE-free.
 *
 * Strategy:
 *  - Read first worksheet only; warn when more exist
 *  - Header row inferred from row 1; subsequent rows become objects
 *  - Date cells come back as JS Date — toString() in mappers works
 *  - sanitizeCsvRow escapes leading =/+/-/@ to defeat formula injection
 *    on re-export
 *
 * Memory: ExcelJS streams cells on read, but for compatibility with
 * the existing pipeline (returns RawRow[]) we materialize all rows.
 * For very large workbooks (>50k rows), swap to a streaming reader.
 */
export class ExcelAdapter implements ImporterAdapter {
  readonly id = 'excel';
  readonly label = 'Excel (.xlsx, .xls)';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    const ext = input.fileName.toLowerCase().split('.').pop();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return true;
    return /spreadsheetml|ms-excel|vnd\.ms-excel/i.test(input.mimeType);
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    const wb = new ExcelJS.Workbook();
    try {
      // ExcelJS types require ArrayBuffer; Node Buffer has the same wire
      // shape but a different TS tag. Slice into the underlying ArrayBuffer.
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      await wb.xlsx.load(ab as ArrayBuffer);
    } catch (err) {
      throw new Error(`Failed to read Excel workbook: ${(err as Error).message}`);
    }

    const sheetCount = wb.worksheets.length;
    if (sheetCount === 0) {
      return { rows: [], warnings: ['Workbook has no sheets'] };
    }

    const sheet = wb.worksheets[0]!;
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? '').trim();
    });

    if (headers.length === 0) {
      return { rows: [], warnings: [`Sheet "${sheet.name}" has no header row`] };
    }

    const rows: RawRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const obj: RawRow = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const key = headers[colNumber - 1];
        if (!key) return;
        const v = cell.value;
        // ExcelJS returns dates as Date, strings as strings, numbers as
        // numbers, formulas as { result } objects. Normalise to string for
        // the downstream mapper consistency (CSV path emits strings too).
        if (v == null) return;
        if (v instanceof Date) {
          obj[key] = v.toISOString();
        } else if (typeof v === 'object' && 'result' in v) {
          obj[key] = String(v.result ?? '');
        } else {
          obj[key] = String(v);
        }
        if (obj[key] !== '') hasValue = true;
      });
      if (hasValue) rows.push(sanitizeCsvRow(obj as Record<string, unknown>) as RawRow);
    });

    const warnings: string[] = [];
    if (sheetCount > 1) {
      const others = wb.worksheets.slice(1).map((s) => s.name);
      warnings.push(
        `Workbook has ${sheetCount} sheets — only "${sheet.name}" was imported. Other sheets: ${others.join(', ')}`,
      );
    }

    return { rows, warnings, detectedLocale: 'unknown' };
  }
}
