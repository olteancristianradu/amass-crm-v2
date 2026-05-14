import { CsvAdapter } from './csv.adapter';
import { ExcelAdapter } from './excel.adapter';
import { GestComAdapter } from './gestcom.adapter';
import { PdfAdapter } from './pdf.adapter';
import { SagaAdapter } from './saga.adapter';
import { SmartBillAdapter } from './smartbill.adapter';
import type { ImporterAdapter } from './types';

/**
 * Ordered registry of adapters. The first one that returns true from
 * `canHandle()` wins. Order matters when extensions overlap (e.g. both
 * SmartBill and a generic XML adapter could match `.xml`).
 *
 * Add new adapters here. Each adapter must self-document its activation
 * status in its file header (see csv.adapter.ts as the reference shape).
 */
// Order matters: more specific adapters first (SAGA matches `saga-*.csv`,
// SmartBill matches `smartbill-*.xml`, GestCom matches gestcom-*.pdf), then
// generic CSV/Excel, then PDF as the fallback for unhinted PDFs.
export const REGISTERED_ADAPTERS: ImporterAdapter[] = [
  new GestComAdapter(),
  new SagaAdapter(),
  new SmartBillAdapter(),
  new CsvAdapter(),
  new ExcelAdapter(),
  new PdfAdapter(),
];

export function pickAdapter(input: {
  mimeType: string;
  fileName: string;
  magicBytes?: Buffer;
}): ImporterAdapter | null {
  return REGISTERED_ADAPTERS.find((a) => a.canHandle(input)) ?? null;
}

export function listAdapters(): Array<{ id: string; label: string }> {
  return REGISTERED_ADAPTERS.map((a) => ({ id: a.id, label: a.label }));
}
