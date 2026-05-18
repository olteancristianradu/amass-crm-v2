import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { ContractTemplate } from '@prisma/client';

/**
 * Phase 2 F1 — pdfkit-backed PDF renderer.
 *
 * Threat coverage:
 *  - T-ESIGN-T-01 (PDF tampering pre-signature): the SHA-256 hash returned
 *    alongside the buffer is what the ceremony.service.ts persists on
 *    Contract.pdfHash and re-verifies on every signer interaction.
 *  - T-ESIGN-D-01 (size DoS): bodyMd is already capped at 1 MiB by the
 *    Zod schema; this renderer additionally bails if the generated PDF
 *    exceeds 10 MiB (any reasonable contract is well below that).
 *  - Template injection: variable interpolation walks the template's
 *    `variables` allow-list — keys not in the list are NOT interpolated
 *    (the literal `{{key}}` survives in the output). Defense in depth on
 *    top of the controller-side Zod schema.
 *  - Watermarking: an unsigned contract gets a diagonal "DRAFT" watermark
 *    on every page to discourage parties from treating the unsealed PDF
 *    as the final agreement.
 */

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface PdfRenderInput {
  template: Pick<ContractTemplate, 'bodyMd' | 'variables'>;
  // Fixed metadata stamped in the header — caller passes the resolved
  // contract title, company name, and creation date.
  contract: {
    id: string;
    title: string;
    companyName: string;
    createdAt: Date;
  };
  // Free-form payload validated by the controller against the template's
  // allow-list. The renderer re-validates so a misbehaving caller can
  // never sneak `{{user.passwordHash}}` style keys through.
  fieldValues: Record<string, string | number | boolean | null>;
  // When false, applies the diagonal "DRAFT" watermark.
  isFinal: boolean;
}

export interface PdfRenderOutput {
  buffer: Buffer;
  sha256: string;
  byteLength: number;
}

@Injectable()
export class PdfGeneratorService {
  async renderContract(input: PdfRenderInput): Promise<PdfRenderOutput> {
    const interpolated = this.interpolate(input.template.bodyMd, input.template.variables, input.fieldValues);

    const buffer = await this.draw({
      contract: input.contract,
      body: interpolated,
      isFinal: input.isFinal,
    });

    if (buffer.length > MAX_PDF_BYTES) {
      throw new Error(
        `Rendered PDF exceeds ${MAX_PDF_BYTES} bytes (got ${buffer.length}) — T-ESIGN-D-01 guard`,
      );
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256, byteLength: buffer.length };
  }

  /**
   * Strict allow-list interpolation. The template's `variables` field is a
   * JSON array of `{ key, label, type, required, defaultValue }`. Any
   * placeholder NOT in the allow-list survives literally — the FE preview
   * can surface that as a "missing variable" warning, and we never leak
   * sensitive context like `{{user.passwordHash}}`.
   *
   * Public so unit tests can exercise it directly without spinning up the
   * full draw pipeline.
   */
  interpolate(
    bodyMd: string,
    variables: unknown,
    fieldValues: Record<string, string | number | boolean | null>,
  ): string {
    const allowed = this.extractAllowedKeys(variables);
    return bodyMd.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g, (_match, key: string) => {
      if (!allowed.has(key)) {
        // Leave the placeholder verbatim so the FE preview can highlight it.
        return `{{${key}}}`;
      }
      const v = fieldValues[key];
      if (v === null || v === undefined) return '';
      return String(v);
    });
  }

  private extractAllowedKeys(variables: unknown): Set<string> {
    if (!Array.isArray(variables)) return new Set();
    const out = new Set<string>();
    for (const v of variables) {
      if (v && typeof v === 'object' && 'key' in v && typeof (v as { key: unknown }).key === 'string') {
        out.add((v as { key: string }).key);
      }
    }
    return out;
  }

  private async draw(args: {
    contract: PdfRenderInput['contract'];
    body: string;
    isFinal: boolean;
  }): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 72, bottom: 72, left: 72, right: 72 },
          info: {
            Title: args.contract.title,
            Subject: `Contract — ${args.contract.companyName}`,
            Creator: 'amass-crm',
            CreationDate: args.contract.createdAt,
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err: Error) => reject(err));

        // ── Header ────────────────────────────────────────────────────
        doc.fontSize(18).text(args.contract.title, { align: 'center' });
        doc.moveDown(0.5);
        doc
          .fontSize(10)
          .fillColor('#555')
          .text(`${args.contract.companyName} · ID: ${args.contract.id}`, { align: 'center' })
          .text(`Generated: ${args.contract.createdAt.toISOString()}`, { align: 'center' });
        doc.moveDown(1);
        doc.fillColor('#000');

        // ── Body ──────────────────────────────────────────────────────
        // Markdown is rendered as plain text — pdfkit's built-in text
        // engine doesn't speak markdown, and we want deterministic output
        // for the hash chain. A future enhancement can swap this for a
        // markdown→PDF renderer (markdown-it + pdfkit-table) once we have
        // a representative set of tenant templates.
        doc.fontSize(11).text(args.body, { align: 'left', lineGap: 2 });

        // ── DRAFT watermark ───────────────────────────────────────────
        if (!args.isFinal) {
          const pages = doc.bufferedPageRange();
          for (let i = pages.start; i < pages.start + pages.count; i++) {
            doc.switchToPage(i);
            doc.save();
            doc
              .fillColor('#cccccc')
              .opacity(0.35)
              .fontSize(96)
              .rotate(45, { origin: [298, 421] })
              .text('DRAFT', 0, 280, { align: 'center', width: 595 });
            doc.restore();
          }
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
