import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { Invoice, InvoiceLine } from '@prisma/client';

/**
 * Renders an Invoice (+ lines) into a PDF Buffer using pdfkit.
 *
 * Layout is intentionally minimal: header, invoice meta (series/number,
 * dates), company-to block placeholder, line items table, totals block.
 * Good enough for RO tax/accounting — the user can always upload a
 * branded template later.
 *
 * Notes:
 *  - All money is shown with 2 decimals, comma separator (Romanian locale).
 *  - We embed only the default PDF fonts (Helvetica) so the bundle stays
 *    small and we don't need external TTFs in the Docker image.
 */
@Injectable()
export class InvoicePdfService {
  async render(
    invoice: Invoice & { lines: InvoiceLine[] },
    companyName: string,
    tenantName: string,
  ): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const number = `${invoice.series}-${String(invoice.number).padStart(4, '0')}`;

    doc.font('Helvetica-Bold').fontSize(20).text('FACTURĂ', { align: 'left' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(12).text(`Nr. ${number}`);

    doc.moveDown(1.2);
    doc.fontSize(10);
    doc.text(`Emitent: ${tenantName}`);
    doc.text(`Client: ${companyName}`);
    doc.moveDown(0.3);
    doc.text(`Data emiterii: ${fmtDate(invoice.issueDate)}`);
    doc.text(`Scadență:       ${fmtDate(invoice.dueDate)}`);
    doc.text(`Status:         ${invoice.status}`);

    doc.moveDown(1);
    drawLineItems(doc, invoice.lines);

    doc.moveDown(0.8);
    const totalsX = 360;
    doc.font('Helvetica').fontSize(10);
    labelValue(doc, 'Subtotal', fmtMoney(invoice.subtotal.toString()), totalsX);
    labelValue(doc, 'TVA',      fmtMoney(invoice.vatAmount.toString()), totalsX);
    doc.font('Helvetica-Bold');
    labelValue(doc, `Total (${invoice.currency})`, fmtMoney(invoice.total.toString()), totalsX);

    if (invoice.notes) {
      doc.moveDown(1.2);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('Note:');
      doc.fillColor('black').text(invoice.notes);
    }

    doc.end();
    return done;
  }
}

function drawLineItems(doc: PDFKit.PDFDocument, lines: InvoiceLine[]): void {
  const headers = ['#', 'Descriere', 'Cant.', 'Preț unit.', 'TVA %', 'Subtotal', 'Total'];
  const widths = [20, 200, 40, 65, 45, 65, 65];
  const startX = doc.page.margins.left;
  let y = doc.y;

  doc.font('Helvetica-Bold').fontSize(9);
  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x + 2, y, { width: widths[i], align: i >= 2 ? 'right' : 'left' });
    x += widths[i];
  });
  y += 16;
  doc.moveTo(startX, y - 2).lineTo(startX + widths.reduce((a, b) => a + b, 0), y - 2).stroke();

  doc.font('Helvetica').fontSize(9);
  for (const line of lines) {
    x = startX;
    const cells = [
      String(line.position + 1),
      line.description,
      line.quantity.toString(),
      fmtMoney(line.unitPrice.toString()),
      line.vatRate.toString(),
      fmtMoney(line.subtotal.toString()),
      fmtMoney(line.total.toString()),
    ];
    cells.forEach((c, i) => {
      doc.text(c, x + 2, y, { width: widths[i], align: i >= 2 ? 'right' : 'left' });
      x += widths[i];
    });
    y += 16;
  }
  doc.y = y + 4;
}

function labelValue(doc: PDFKit.PDFDocument, label: string, value: string, startX: number): void {
  const y = doc.y;
  doc.text(label, startX, y, { width: 100, align: 'left' });
  doc.text(value, startX + 100, y, { width: 100, align: 'right' });
  doc.moveDown(0.3);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtMoney(s: string): string {
  const n = Number(s);
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
