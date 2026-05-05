import Papa from 'papaparse';
import { sanitizeCsvRow } from '../../../common/utils/csv-safe';
import type { ImporterAdapter, ParseResult, RawRow } from './types';

/**
 * Plain CSV adapter — header row + comma/semicolon-delimited values.
 * Handles Romanian Excel exports which often use `;` as the delimiter
 * (because comma is the decimal separator in RO locale).
 *
 * Header normalisation strips BOM and trims; the mapper does the rest.
 */
export class CsvAdapter implements ImporterAdapter {
  readonly id = 'csv';
  readonly label = 'CSV (.csv, .txt)';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    const ext = input.fileName.toLowerCase().split('.').pop();
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return true;
    return /text\/csv|application\/csv|text\/plain|text\/tab-separated-values/i.test(input.mimeType);
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    const text = buffer.toString('utf8');
    const parsed = Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      // Auto-detect comma vs semicolon (RO Excel) vs tab.
      delimiter: '',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
    });

    const rows: RawRow[] = parsed.data
      .map((r) => sanitizeCsvRow(r as Record<string, unknown>))
      .filter((r) => Object.values(r).some((v) => v !== '' && v !== null && v !== undefined));

    const warnings = parsed.errors.slice(0, 20).map((e) => `row ${e.row}: ${e.message}`);

    return { rows, warnings, detectedLocale: 'unknown' };
  }
}
