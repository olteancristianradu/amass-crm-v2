import type { ImporterAdapter, ParseResult, RawRow } from './types';

/**
 * PDF importer adapter — TEXT extraction.
 *
 * Three flavors of PDFs in the wild:
 *   A. Text PDFs (generated from Word/Excel/online tools) — handled here
 *      via pdf-parse. Returns the full text; we then attempt naive
 *      key:value heuristics for common Romanian invoice fields (CIF,
 *      Total, Furnizor, Client, etc.) so a single-row "import" still
 *      surfaces useful structured data.
 *   B. Scanned PDFs (image-only) — no text layer. Detected when the
 *      extracted text length is below a small threshold. We surface a
 *      warning and recommend OCR fallback (next iteration).
 *   C. Form-fillable PDFs — pdf-parse returns the field values inline.
 *
 * Output shape: a single RawRow per page. Mappers can either treat each
 * page as a separate entity, or post-process by aggregating fields.
 *
 * Privacy: PDFs often contain CNPs and other PII. The same redaction
 * rules apply downstream — see `apps/ai-worker/app/redaction.py`. This
 * adapter does NOT redact at parse time; it surfaces raw extracted
 * fields so the operator can review.
 */
export class PdfAdapter implements ImporterAdapter {
  readonly id = 'pdf';
  readonly label = 'PDF (text or scanned)';

  /** Minimum text length below which we suspect a scanned PDF needing OCR. */
  private static readonly SCANNED_PDF_THRESHOLD_CHARS = 50;

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    return /\.pdf$/i.test(input.fileName) || /pdf/i.test(input.mimeType);
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    const warnings: string[] = [];

    // Dynamic import: pdf-parse pulls in heavy deps and we don't want
    // them in the bundle until a PDF actually shows up. The dependency
    // also has a side effect at require time (reads a sample file)
    // that crashes if the package is in an unusual layout — dynamic
    // import keeps this isolated to the call site.
    let pdfParse: (b: Buffer) => Promise<{ text: string; numpages: number; info?: Record<string, unknown> }>;
    try {
      const mod = (await import('pdf-parse')) as unknown as {
        default: typeof pdfParse;
      };
      pdfParse = mod.default;
    } catch (err) {
      throw new Error(`PDF parser unavailable: ${(err as Error).message}`);
    }

    let parsed: Awaited<ReturnType<typeof pdfParse>>;
    try {
      parsed = await pdfParse(buffer);
    } catch (err) {
      throw new Error(`Failed to parse PDF: ${(err as Error).message}`);
    }

    let text = (parsed.text ?? '').trim();
    if (text.length < PdfAdapter.SCANNED_PDF_THRESHOLD_CHARS) {
      // Scanned PDF — attempt OCR via Gemini vision if API key is set.
      const ocrText = await ocrWithGemini(buffer);
      if (ocrText && ocrText.length >= PdfAdapter.SCANNED_PDF_THRESHOLD_CHARS) {
        text = ocrText;
        warnings.push(`Used Gemini vision OCR (${ocrText.length} chars recovered).`);
      } else {
        warnings.push(
          `PDF text extraction returned only ${text.length} chars and OCR fallback yielded nothing. ${
            process.env['GEMINI_API_KEY']
              ? 'Gemini call may have failed — check logs.'
              : 'GEMINI_API_KEY not set — scanned PDFs will not work.'
          }`,
        );
        return { rows: [], warnings };
      }
    }

    // Attempt naive Romanian-invoice heuristics. This is intentionally
    // conservative — false positives are worse than missing fields.
    const fields: RawRow = {};
    fields['_pdf_pages'] = parsed.numpages;
    fields['_pdf_text'] = text;

    const cif = text.match(/\bCIF[\s:]*([A-Z]{0,2}\d{2,10})/i);
    if (cif?.[1]) fields['CIF'] = cif[1];

    const cnp = text.match(/\bCNP[\s:]*(\d{13})\b/i);
    if (cnp?.[1]) fields['CNP'] = cnp[1];

    const total = text.match(/\bTotal[\s:]*([\d.,]+)\s*(RON|EUR|USD)?/i);
    if (total?.[1]) {
      fields['Total'] = total[1];
      if (total[2]) fields['Currency'] = total[2];
    }

    const furnizor = text.match(/\bFurnizor[\s:]*([A-Z][^\n\r]{2,80})/i);
    if (furnizor?.[1]) fields['Furnizor'] = furnizor[1].trim();

    const client = text.match(/\bClient[\s:]*([A-Z][^\n\r]{2,80})/i);
    if (client?.[1]) fields['Client'] = client[1].trim();

    const invoiceNo = text.match(/\b(?:Factur[ăa]\s*(?:Nr|nr|seria|numar)|Invoice\s*(?:No|Number))[\s:.]+([A-Z0-9-]{2,30})/i);
    if (invoiceNo?.[1]) fields['InvoiceNumber'] = invoiceNo[1];

    if (Object.keys(fields).length <= 2) {
      warnings.push(
        'No structured fields recognized — the operator should review the raw text and map manually.',
      );
    }

    return {
      rows: [fields],
      warnings,
      detectedLocale: /\b(furnizor|factur[ăa]|cif|cnp|total)\b/i.test(text) ? 'ro' : 'unknown',
    };
  }
}

/**
 * Last-resort OCR via Gemini vision. Only runs when pdf-parse failed
 * to extract usable text and GEMINI_API_KEY is present. Costs are
 * tracked per-call by the API quota — the free tier (1500 req/day)
 * absorbs typical SMB import volume.
 *
 * Returns the extracted text or `null` on any failure (missing key,
 * network, API error). The caller decides whether the result is
 * usable.
 */
async function ocrWithGemini(pdfBuffer: Buffer): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    // gemini-1.5-flash supports PDFs as `inlineData` — accepts up to
    // 1000 pages. We send the full file at once.
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBuffer.toString('base64'),
        },
      },
      {
        text: `Extract ALL text from this PDF document, preserving line breaks. If it's a Romanian invoice, keep the field labels (CIF, Total, Furnizor, Client, Factură Nr., etc.) intact. Return ONLY the text — no commentary.`,
      },
    ]);

    const response = result.response;
    const text = response.text();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pdf.adapter] Gemini OCR failed:', err);
    return null;
  }
}
