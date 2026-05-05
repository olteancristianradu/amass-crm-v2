import type { ImporterAdapter, ParseResult } from './types';

/**
 * PDF importer adapter.
 *
 * STATUS: scaffold + plan. Most-complex of all adapters. PDFs come in
 * three flavors:
 *
 *   A. Text PDFs (generated from Word/Excel) — extract via pdf-parse.
 *      Then parse the resulting text against expected layout (table
 *      heuristics or Claude vision API for layout understanding).
 *
 *   B. Scanned PDFs (image only) — needs OCR. Options:
 *      - tesseract.js (free, slower, lower accuracy)
 *      - Claude vision via API (paid, much better at tables and RO diacritics)
 *      - Google Cloud Vision OCR
 *
 *   C. Form-fillable PDFs — pdf-lib can extract fields directly.
 *
 * Recommendation: start with A (text PDFs) using pdf-parse. Add Claude
 * vision for B once we have a customer requesting it (they will probably
 * have a specific invoice/quote PDF format we can fine-tune for).
 *
 * Activation:
 *   1. pnpm --filter @amass/api add pdf-parse
 *   2. Implement text extraction. Use heuristics for typical Romanian
 *      invoice layouts (CIF on top right, total on bottom right, etc.).
 *   3. Add OCR fallback when text extraction returns < 100 chars.
 *
 * Privacy note: PDFs often contain CNPs and other PII. The OCR path
 * via external API needs to honour the same redaction rules as the
 * call transcription pipeline (see apps/ai-worker/app/redaction.py).
 */
export class PdfAdapter implements ImporterAdapter {
  readonly id = 'pdf';
  readonly label = 'PDF (text or scanned)';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    return /\.pdf$/i.test(input.fileName) || /pdf/i.test(input.mimeType);
  }

  async parse(_buffer: Buffer): Promise<ParseResult> {
    throw new Error(
      'PDF adapter not yet wired — needs pdf-parse and OCR fallback. See adapters/pdf.adapter.ts.',
    );
  }
}

