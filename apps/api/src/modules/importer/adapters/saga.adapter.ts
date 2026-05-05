import type { ImporterAdapter, ParseResult } from './types';

/**
 * SAGA (Romanian accounting software) export adapter.
 *
 * STATUS: scaffold. SAGA exports CSV with semicolon delimiters, Windows-1250
 * encoding, and Romanian accounting-specific columns (DenumireClient, CIF,
 * Sold, etc.). Different versions of SAGA have slightly different column sets.
 *
 * Activation:
 *   1. Get a sample export from a SAGA Office tenant.
 *   2. Detect by header signature (presence of Romanian accounting columns).
 *   3. Convert from Windows-1250 (`iconv-lite` already widely available
 *      via Buffer encoding APIs).
 *   4. Reuse Papa.parse with `;` delimiter.
 *
 * Note: SAGA Mic Birou (the cheap local version) and SAGA C/SAGA Office
 * (cloud) have different export formats. Both should be supported.
 */
export class SagaAdapter implements ImporterAdapter {
  readonly id = 'saga';
  readonly label = 'SAGA accounting export (CSV with RO encoding)';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    return /saga.*\.csv$/i.test(input.fileName);
  }

  async parse(_buffer: Buffer): Promise<ParseResult> {
    throw new Error(
      'SAGA adapter not yet wired — needs sample export + Windows-1250 decoding. See adapters/saga.adapter.ts.',
    );
  }
}

