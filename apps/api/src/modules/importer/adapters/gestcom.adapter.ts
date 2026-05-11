import type { ImporterAdapter, ParseResult, RawRow } from './types';

/**
 * GestCom Sales (gestcom.ro) — PDF export of the `lucrari` (records) table.
 *
 * Why this exists:
 *   GestCom is a popular Romanian CRM-lite used by SMBs (Flair / Amass
 *   themselves used it for years). It has no JSON/CSV export — only a
 *   PDF rendering of the HTML table. That PDF carries:
 *     - 11 columns (NR./NUME, APLICATIE, SURSA, SUPRAFATA, SITUATIE,
 *       AGENT, JUDET, STADIU, DATA DECIZIE, PRIORITATE, OBSERVATII)
 *     - the OBSERVATII column contains a semi-structured log of contact
 *       data (Nume / Prenume / Email / Telefon / Oras / ...) followed by
 *       a free-text call log with dated entries.
 *
 * Strategy:
 *   1. pdf-parse → plain text (per-page concatenated).
 *   2. Split by record boundaries. Each record's OBSERVATII column
 *      contains a unique marker — `Domeniu de utilizare: AMASS.RO` or
 *      just `Nume: <X>` — that we use as the split anchor.
 *   3. For each record block, extract:
 *      - Contact identity: Nume / Prenume / Email / Telefon / Oras
 *      - GestCom-specific metadata: SUPRAFATA / SITUATIE / JUDET /
 *        STADIU / DATA_DECIZIE / APLICATIE (best-effort from the
 *        surrounding text)
 *      - Raw observatii text (we keep it as `_gestcom_observatii` so
 *        the mapper can post-process into Activities)
 *
 * Output: one RawRow per record. Keys map to the candidate keys the
 * existing gestcom-mapper.ts already recognises (Nume, Prenume, Email,
 * Telefon, Oras), so downstream processing works without changes.
 *
 * Heuristic limits:
 *   - PDF text extraction loses some whitespace / column alignment.
 *     Per-record metadata (SITUATIE, JUDET) extraction is best-effort
 *     and may miss values when the text reflows. The OBSERVATII text
 *     stays intact regardless.
 *   - Records WITHOUT a "Nume:" line (rare — usually placeholder rows)
 *     are skipped with a warning.
 */
export class GestComAdapter implements ImporterAdapter {
  readonly id = 'gestcom-pdf';
  readonly label = 'GestCom Sales (PDF export)';

  canHandle(input: { mimeType: string; fileName: string }): boolean {
    // Only activate when both a PDF extension AND a GestCom hint are
    // present in the filename. We do not want to hijack every PDF — the
    // generic PdfAdapter still owns single-document invoices.
    const isPdf = /\.pdf$/i.test(input.fileName) || /pdf/i.test(input.mimeType);
    const hasHint = /gestcom|lucrari|amass[_-]?export/i.test(input.fileName);
    return isPdf && hasHint;
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    const warnings: string[] = [];

    // pdf-parse v2+ exports a `PDFParse` class — there is no default
    // callable. We construct an instance per call and discard it; the
    // library is stateless across invocations.
    let text: string;
    try {
      const mod = (await import('pdf-parse')) as unknown as {
        PDFParse: new (init: { data: Buffer }) => { getText(): Promise<{ text: string }> };
      };
      const parser = new mod.PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text ?? '';
    } catch (err) {
      throw new Error(`Failed to parse GestCom PDF: ${(err as Error).message}`);
    }
    if (text.length < 200) {
      warnings.push(
        'GestCom PDF returned almost no text. This usually means the PDF is image-only — re-export with text mode enabled in GestCom.',
      );
      return { rows: [], warnings };
    }

    const blocks = splitIntoRecordBlocks(text);
    if (blocks.length === 0) {
      warnings.push(
        'No GestCom records detected. Make sure the export is the "Lucrări" report (gestcom.ro/<tenant>/index.php?m=lucrari) and not a different page.',
      );
      return { rows: [], warnings };
    }

    const rows: RawRow[] = [];
    let incompleteCount = 0;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const row = parseRecord(block);
      if (!row['Nume'] && !row['Prenume'] && !row['Telefon']) {
        warnings.push(`Record #${i + 1} skipped — no Nume/Prenume/Telefon extracted.`);
        continue;
      }
      // A complete record has at least Nume + Email/Telefon. Page breaks
      // in the source PDF can split a record's fields across two pages,
      // which our regex cannot reconnect — flag this so the operator
      // knows to spot-check.
      if (!row['Email'] && !row['Telefon']) incompleteCount++;
      rows.push(row);
    }

    if (incompleteCount > rows.length * 0.1) {
      warnings.push(
        `${incompleteCount} of ${rows.length} records are missing Email + Telefon. PDF text extraction loses field-to-record association when a record crosses a page break; if possible, request a CSV export from GestCom for full fidelity.`,
      );
    }

    return {
      rows,
      warnings,
      detectedLocale: 'ro',
    };
  }
}

/**
 * Split the full PDF text into one block per record.
 *
 * Each record in the PDF has a TABLE-ROW header line (slug + APLICATIE +
 * SURSA + SUPRAFATA + SITUATIE + AGENT + JUDET + STADIU + DATA_DECIZIE)
 * followed by an OBSERVATII column (starts with `Domeniu de utilizare:`).
 *
 * We split on the start of each header line so that:
 *   • The slug line above the header (`Andine Justinian - constanta (2)`)
 *     stays attached to the CURRENT record's block.
 *   • Record N's body cannot bleed into Record N+1's block because the
 *     header line starts right after the previous body ends.
 */
// Record header anchor — the table-row line for each record:
// `<APLICATIE> <SURSA> <SUPRAFATA> <SITUATIE> <agent> <JUDET> <STADIU> <DATE>`.
// Kept as a literal with `/g` baked in so each splitIntoRecordBlocks call
// gets a fresh lastIndex via matchAll. eslint's security/detect-non-literal-regexp
// only allows literals — avoid the `new RegExp(...)` form.
const RECORD_HEADER_RE_G =
  /\b(?:RADIATOARE|INCALZIRE_PARDOSEALA)(?:[ _]RADIATOARE)?\s+(?:SITE|SMS|MAIL)\s+\d+\s+(?:CONTRACTATA|ANULATA|VALABILA)\s+[a-z][\w.-]+\s+[A-Z][A-Z\s-]+\s+(?:FUNDATIE|RENOVARE|CONSTRUCTIE|FINISAJE)\s+\d{2}\.\d{2}\.\d{4}/g;

// Anchor at the OBSERVATII column header — exactly one occurrence per
// record. Reliable because pdf-parse text-extraction can reorder the
// table-row HEADER (slug + APLICATIE + ...) vs the OBSERVATII fields
// across page breaks (the OBSERVATII column extends down further than
// the left-side cells, so its text often appears AHEAD of the
// table-row header for the same record).
const DOMENIU_RE_G = /Domeniu de utilizare:/g;

// "Nume: " with a non-empty value on the same line. Catches contact-form
// rows where the export skipped the "Domeniu de utilizare:" prefix.
// The leading look-behind avoids matching "Prenume:".
const NUME_FIELD_RE_G = /(?<![A-Za-z])Nume:[ \t]+\S[^\n\r]*/g;

export function splitIntoRecordBlocks(text: string): string[] {
  const domeniuPositions: number[] = [];
  for (const m of text.matchAll(DOMENIU_RE_G)) {
    if (m.index !== undefined) domeniuPositions.push(m.index);
  }

  // Supplement: records like "Andine Justinian" in the real GestCom
  // export skip the "Domeniu de utilizare:" line entirely. For each
  // Nume: position, check whether a Domeniu anchor sits CLOSELY BEFORE
  // it (within 100 chars — matches "Domeniu de utilizare: AMASS.RO\n"
  // immediately followed by Nume:). If not, this Nume is the actual
  // record anchor (the export skipped Domeniu).
  const orphanNume: number[] = [];
  for (const m of text.matchAll(NUME_FIELD_RE_G)) {
    if (m.index === undefined) continue;
    const before = domeniuPositions.filter((p) => p < m.index!).pop();
    if (before === undefined || m.index - before > 100) {
      orphanNume.push(m.index);
    }
  }
  const anchors = [...domeniuPositions, ...orphanNume].sort((a, b) => a - b);

  if (anchors.length === 0) {
    // No anchor at all — likely an image-only PDF. Return nothing.
    return [];
  }

  // For each anchor, look BACK for the most recent table-row header
  // (RECORD_HEADER_RE_G match). If one sits within a reasonable distance
  // of the anchor AND no contact-field marker stands between the header
  // and the anchor, include the header in this record's block. Otherwise
  // the block starts at the anchor itself. This handles both:
  //   - Synthetic test fixtures: header is immediately above "Domeniu…"
  //   - Real PDFs: pdf-parse reads OBSERVATII before the table-row
  //     header, so the header sits AFTER "Domeniu…" (already inside the
  //     forward span — no look-back needed).
  const tableHeaderPositions: number[] = [];
  for (const m of text.matchAll(RECORD_HEADER_RE_G)) {
    if (m.index !== undefined) tableHeaderPositions.push(m.index);
  }

  // For each anchor i, find the largest tableHeaderPositions value that
  // is < anchor[i] and > anchor[i-1] (or 0). That's "the header from
  // this record's left-column block, rendered before its observatii".
  const blocks: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]!;
    const prevAnchor = i === 0 ? 0 : anchors[i - 1]!;
    // Largest table-header position < anchor and > prevAnchor.
    let candidate = -1;
    for (const hp of tableHeaderPositions) {
      if (hp > prevAnchor && hp < anchor) candidate = Math.max(candidate, hp);
      else if (hp >= anchor) break;
    }
    // Look-back start: the header position if found close enough, else
    // the anchor itself. Cap distance at 200 chars so we don't pull in
    // previous-record tail data when the records are tightly packed.
    let start = anchor;
    if (candidate >= 0 && anchor - candidate <= 200) {
      // Walk back from `candidate` to the START of its line (so we
      // include the slug line above the header too).
      let i2 = candidate;
      while (i2 > prevAnchor && text[i2] !== '\n' && text[i2] !== '\r') i2--;
      // One line up — the slug line.
      let i3 = i2 - 1;
      while (i3 > prevAnchor && (text[i3] === '\n' || text[i3] === '\r')) i3--;
      while (i3 > prevAnchor && text[i3] !== '\n' && text[i3] !== '\r') i3--;
      start = Math.max(prevAnchor, i3 + 1);
    }

    const end = i + 1 < anchors.length ? anchors[i + 1]! : text.length;
    blocks.push(text.slice(start, end));
  }
  return blocks.filter((b) => /(?<![A-Za-z])Nume:/.test(b));
}

/**
 * Page-break detector — used by tests + the warning path to confirm
 * we still find table-row headers across the whole document even when
 * they're no longer the split anchor.
 */
export function countTableRowHeaders(text: string): number {
  return Array.from(text.matchAll(RECORD_HEADER_RE_G)).length;
}

/**
 * Extract structured fields from a single record block. Keys match the
 * candidates the gestcom-mapper.ts already recognises for downstream
 * mapping to Contact / Company / Activity.
 */
export function parseRecord(block: string): RawRow {
  const row: RawRow = {};

  const grab = (label: string, pattern: RegExp): string | null => {
    const m = block.match(pattern);
    return m?.[1]?.trim() ?? null;
  };

  // Contact identity (these map directly to gestcom-mapper.ts candidates).
  // Each value MUST be on the same line as its label — we use `[ \t]+`
  // (tab/space only, not newline) between label and value, then capture
  // everything until end-of-line. This prevents the next field name from
  // bleeding into the previous field's value when an export has empty
  // fields (`Nume:\n      Prenume:` would otherwise grab "Prenume:" as
  // the Nume value).
  const nume = grab('Nume', /^[ \t]*Nume:[ \t]+([^\n\r]+?)[ \t]*$/m);
  const prenume = grab('Prenume', /^[ \t]*Prenume:[ \t]+([^\n\r]+?)[ \t]*$/m);
  const email = grab('Email', /\bEmail:[ \t]+(\S+@\S+)/);
  const telefon = grab('Telefon', /\bTelefon:[ \t]+(\+?\d[\d\s().-]{6,})/);
  const oras = grab('Oras', /^[ \t]*Oras:[ \t]+([^\n\r]+?)[ \t]*$/m);
  // Suprafata in GestCom is always an integer (no decimals observed in
  // 808+ records). Keep the regex linear — eslint's safe-regex flags
  // anything with nested quantifiers.
  const suprafataField = grab('Suprafata', /\bSuprafata:[ \t]+(\d+)/);

  if (nume) row['Nume'] = nume;
  if (prenume) row['Prenume'] = prenume;
  if (email) row['Email'] = email;
  if (telefon) row['Telefon'] = telefon.replace(/\s+/g, '');
  if (oras) row['Oras'] = oras;
  if (suprafataField) row['Suprafata'] = Number(suprafataField);

  // Free-text fields that downstream tooling can read out of the row.
  // Keep the keys prefixed so they don't collide with the contact fields.
  // Same single-line discipline as the identity fields — empty values
  // must not absorb the next field's label.
  const stadiu = grab(
    'stadiul casei',
    /^[ \t]*Alegeti stadiul casei:[ \t]+([^\n\r]+?)[ \t]*$/m,
  );
  if (stadiu) row['_gestcom_stadiu_casei'] = stadiu;

  const pftv = grab(
    'panouri fotovoltaice',
    /^[ \t]*Conectare incalzire la Panouri fotovoltaice:[ \t]+([^\n\r]+?)[ \t]*$/m,
  );
  if (pftv) row['_gestcom_pftv'] = pftv;

  // Search the block for SITUATIE / STADIU / JUDET keywords. These can
  // appear anywhere because the surrounding table cells reflow when the
  // PDF rasterises long observatii. Use word-boundary anchors.
  const situatie = block.match(/\b(CONTRACTATA|ANULATA|VALABILA)\b/);
  if (situatie) row['_gestcom_situatie'] = situatie[1];

  const stadiu2 = block.match(/\b(FUNDATIE|RENOVARE|CONSTRUCTIE|FINISAJE)\b/);
  if (stadiu2) row['_gestcom_stadiu_lucrare'] = stadiu2[1];

  const judet = block.match(/\b(SUCEAVA|BRASOV|BUCURESTI|CLUJ|TIMIS|IASI|CONSTANTA|GALATI|PRAHOVA|DAMBOVITA|ARGES|VALCEA|GORJ|MEHEDINTI|OLT|DOLJ|TELEORMAN|GIURGIU|ILFOV|CALARASI|IALOMITA|BUZAU|VRANCEA|BACAU|VASLUI|BOTOSANI|NEAMT|HARGHITA|COVASNA|MURES|ALBA|SIBIU|HUNEDOARA|BIHOR|SALAJ|SATU MARE|MARAMURES|BISTRITA-NASAUD|ARAD|CARAS-SEVERIN|CARAS|TULCEA|BRAILA)\b/);
  if (judet) row['_gestcom_judet'] = judet[1];

  const aplicatie = block.match(/\b(RADIATOARE|INCALZIRE_PARDOSEALA)\b/);
  if (aplicatie) row['_gestcom_aplicatie'] = aplicatie[1];

  const dataMatch = block.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
  if (dataMatch) row['_gestcom_data_decizie'] = dataMatch[1];

  // Capture the full OBSERVATII text so the mapper can later split it
  // into Activity entries (dated log lines + WhatsApp message blocks).
  row['_gestcom_observatii'] = block.trim();

  return row;
}
