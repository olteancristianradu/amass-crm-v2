import type { ImporterAdapter, ParseResult } from './types';

/**
 * Excel (.xlsx, .xls) adapter.
 *
 * STATUS: scaffold. Wire-up is here, parsing requires the `xlsx` package
 * to be added to apps/api/package.json. Activation steps:
 *   1. pnpm --filter @amass/api add xlsx
 *   2. Replace the `not implemented` throw with the SheetJS read path.
 *   3. Add unit tests covering: single sheet, multi-sheet (use first),
 *      formula cells (read computed value), date cells (preserve ISO).
 *
 * Why not active by default: SheetJS adds ~500KB to the API bundle and
 * has a moderate CVE history. We turn it on only when we have a real
 * Excel sample to test against and a tenant requesting it.
 */
export class ExcelAdapter implements ImporterAdapter {
  readonly id = 'excel';
  readonly label = 'Excel (.xlsx, .xls)';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    const ext = input.fileName.toLowerCase().split('.').pop();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return true;
    return /spreadsheetml|ms-excel|vnd\.ms-excel/i.test(input.mimeType);
  }

  async parse(_buffer: Buffer): Promise<ParseResult> {
    throw new Error(
      'Excel adapter not yet wired — install `xlsx` and replace this throw. See adapters/excel.adapter.ts.',
    );
    // Reference implementation once xlsx is installed:
    //
    // const XLSX = await import('xlsx');
    // const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    // const sheetName = wb.SheetNames[0];
    // if (!sheetName) return { rows: [], warnings: ['workbook has no sheets'] };
    // const sheet = wb.Sheets[sheetName];
    // const json = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: false });
    // const warnings = wb.SheetNames.length > 1
    //   ? [`workbook has ${wb.SheetNames.length} sheets — only "${sheetName}" was imported`]
    //   : [];
    // return { rows: json, warnings, detectedLocale: 'unknown' };
  }
}

