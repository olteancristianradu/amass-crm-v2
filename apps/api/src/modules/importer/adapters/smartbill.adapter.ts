import type { ImporterAdapter, ParseResult } from './types';

/**
 * SmartBill XML export adapter.
 *
 * STATUS: scaffold. SmartBill exports clients/products/invoices as XML
 * over a documented schema. The proprietary format uses Romanian element
 * names like `<Client>`, `<DenumireClient>`, `<CIF>`.
 *
 * Activation:
 *   1. Get a sample export file (from a SmartBill account → Export → XML).
 *   2. Use `fast-xml-parser` (already in pnpm.overrides ≥5.7.0) to parse.
 *   3. Add `<RawRow>` mapping with Romanian → canonical key normalisation.
 *   4. Tests with at least: client export, product export, invoice export.
 *
 * Reference: SmartBill API docs at https://api.smartbill.ro/ — but the
 * XML export schema is separate; check their support portal for samples.
 */
export class SmartBillAdapter implements ImporterAdapter {
  readonly id = 'smartbill';
  readonly label = 'SmartBill XML export';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    if (!/^.*smartbill.*\.xml$/i.test(input.fileName) && !/\.xml$/i.test(input.fileName)) {
      return false;
    }
    return /\.xml$/i.test(input.fileName) || /xml/i.test(input.mimeType);
  }

  async parse(_buffer: Buffer): Promise<ParseResult> {
    throw new Error(
      'SmartBill adapter not yet wired — needs a sample export file and fast-xml-parser integration. See adapters/smartbill.adapter.ts.',
    );
  }
}

