import * as XLSX from 'xlsx';
import { sanitizeCsvRow } from '../../../common/utils/csv-safe';
import type { ImporterAdapter, ParseResult, RawRow } from './types';

/**
 * Excel (.xlsx, .xls, .xlsm) adapter using SheetJS.
 *
 * Strategy:
 *  - Reads only the first sheet. Multi-sheet workbooks emit a warning
 *    so the operator knows others were skipped.
 *  - `cellDates: true` keeps date cells as JS Date objects, not the
 *    Excel serial number. Mappers can call `.toISOString()` on them.
 *  - `raw: false` lets sheet_to_json apply the cell's display format,
 *    so a number formatted as "1.234,56" comes back as that string —
 *    important for Romanian Excel exports that the user might not
 *    have re-saved as standard.
 *  - sanitizeCsvRow escapes leading =/+/-/@ that would re-execute as
 *    a formula if the data is later re-exported to Excel.
 *
 * Memory: SheetJS loads the whole workbook in memory. Bundle is large
 * (~500KB) and rows scale linearly. For >50k-row imports, consider
 * SheetJS streaming or chunked Papa.parse + custom Excel-to-CSV.
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
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch (err) {
      throw new Error(`Failed to read Excel workbook: ${(err as Error).message}`);
    }

    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return { rows: [], warnings: ['Workbook has no sheets'] };
    }

    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      return { rows: [], warnings: [`Sheet "${sheetName}" is empty`] };
    }

    const json = XLSX.utils.sheet_to_json<RawRow>(sheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    const rows = json
      .map((r) => sanitizeCsvRow(r as Record<string, unknown>))
      .filter((r) => Object.values(r).some((v) => v !== '' && v !== null && v !== undefined));

    const warnings: string[] = [];
    if (wb.SheetNames.length > 1) {
      warnings.push(
        `Workbook has ${wb.SheetNames.length} sheets — only "${sheetName}" was imported. Other sheets: ${wb.SheetNames.slice(1).join(', ')}`,
      );
    }

    return { rows: rows as RawRow[], warnings, detectedLocale: 'unknown' };
  }
}
