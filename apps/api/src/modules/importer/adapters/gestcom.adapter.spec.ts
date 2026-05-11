import { describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(({ data }: { data: Buffer }) => ({
    getText: vi.fn(async () => ({ text: data.toString('utf8'), total: 1 })),
  })),
}));

import { GestComAdapter, parseRecord, splitIntoRecordBlocks } from './gestcom.adapter';

const SAMPLE_RECORD = `
Sologon Sorin - Botosani (3)
RADIATOARE SITE 200 VALABILA radu.oltean BOTOSANI RENOVARE 22.10.2025 -
Domeniu de utilizare: AMASS.RO
Nume: SOLOGON
Prenume: Sorin
Email: Sologon.sorin1967@gmail.com
Telefon: 0741177157
Suprafata: 200
Oras: BOTOȘANI
Alegeti stadiul casei: Stau în casă
Conectare incalzire la Panouri fotovoltaice: Vreau in viitor
Cu ce alt sistem de incalzire doriti sa comparati sistemul AMASS?
Sisteme pe ardere (combustie): Alta varianta
Nu voia acum, a pus pe pauza dar am oferit informatii generale.
17.06.2025 Apel inregistrat: discutie productiva.
`.trim();

const SAMPLE_TWO_RECORDS = `
Andine Justinian - constanta (2)
RADIATOARE SITE 100 ANULATA radu.oltean CONSTANTA RENOVARE 31.01.2025 -
Domeniu de utilizare: AMASS.RO
Nume: Andone
Prenume: Justinian
Email: justi_33@yahoo.com
Telefon: 0722392497
Suprafata: 100
Oras: Constanta
Alegeti stadiul casei: Stau în casă
Conectare incalzire la Panouri fotovoltaice: Am panouri fotovoltaice
Cu ce alt sistem de incalzire doriti sa comparati sistemul AMASS?
Sisteme pe ardere (combustie): Centrala gaz
Discutie initiala.
Sologon Sorin - Botosani (3)
RADIATOARE SITE 200 VALABILA radu.oltean BOTOSANI RENOVARE 22.10.2025 -
Domeniu de utilizare: AMASS.RO
Nume: SOLOGON
Prenume: Sorin
Email: Sologon.sorin1967@gmail.com
Telefon: 0741177157
Suprafata: 200
Oras: BOTOȘANI
Alegeti stadiul casei: Stau în casă
`.trim();

describe('GestComAdapter', () => {
  const adapter = new GestComAdapter();

  it('canHandle picks .pdf with a gestcom hint in filename', () => {
    expect(
      adapter.canHandle({ mimeType: 'application/pdf', fileName: 'gestcom-export.pdf' }),
    ).toBe(true);
    expect(
      adapter.canHandle({ mimeType: 'application/pdf', fileName: 'lucrari-2026.pdf' }),
    ).toBe(true);
    expect(
      adapter.canHandle({ mimeType: 'application/pdf', fileName: 'amass-export-2026.pdf' }),
    ).toBe(true);
  });

  it('canHandle rejects a generic PDF (left for the fallback adapter)', () => {
    expect(
      adapter.canHandle({ mimeType: 'application/pdf', fileName: 'invoice.pdf' }),
    ).toBe(false);
  });

  it('canHandle rejects non-PDF mime + extension', () => {
    expect(
      adapter.canHandle({ mimeType: 'text/csv', fileName: 'gestcom.csv' }),
    ).toBe(false);
  });

  it('returns 0 rows + warning when PDF text is too short (likely image-only)', async () => {
    const result = await adapter.parse(Buffer.from('short'));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/image-only/i);
  });

  it('extracts Nume/Prenume/Email/Telefon/Oras/Suprafata from a single record', async () => {
    const result = await adapter.parse(Buffer.from(SAMPLE_RECORD));
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row['Nume']).toBe('SOLOGON');
    expect(row['Prenume']).toBe('Sorin');
    expect(row['Email']).toBe('Sologon.sorin1967@gmail.com');
    expect(row['Telefon']).toBe('0741177157');
    expect(row['Suprafata']).toBe(200);
    expect(row['Oras']).toContain('BOTO');
    expect(row['_gestcom_situatie']).toBe('VALABILA');
    expect(row['_gestcom_judet']).toBe('BOTOSANI');
    expect(row['_gestcom_stadiu_lucrare']).toBe('RENOVARE');
    expect(row['_gestcom_aplicatie']).toBe('RADIATOARE');
    expect(row['_gestcom_data_decizie']).toBe('22.10.2025');
    expect(row['_gestcom_observatii']).toContain('Apel inregistrat');
    expect(result.detectedLocale).toBe('ro');
  });

  it('splits a multi-record PDF into one row per record', async () => {
    const result = await adapter.parse(Buffer.from(SAMPLE_TWO_RECORDS));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!['Nume']).toBe('Andone');
    expect(result.rows[1]!['Nume']).toBe('SOLOGON');
    // Per-record situatie must be scoped to that record's block.
    expect(result.rows[0]!['_gestcom_situatie']).toBe('ANULATA');
    expect(result.rows[1]!['_gestcom_situatie']).toBe('VALABILA');
  });

  it('skips a record where Nume/Prenume/Telefon are all empty', async () => {
    // Valid header row so the splitter detects ONE record, but its
    // OBSERVATII has no contact data — must trigger the per-record skip
    // warning (not the no-records-at-all warning).
    const placeholderOnly = `Ghost Record - placeholder (1)
RADIATOARE SITE 0 ANULATA radu.oltean BUCURESTI RENOVARE 01.01.2026 -
Domeniu de utilizare: AMASS.RO
Nume:
Prenume:
Email:
Telefon:
Suprafata:
Oras:
Alegeti stadiul casei: ?
${'padding line so we cross the 200-char min-text gate. '.repeat(5)}`;
    const result = await adapter.parse(Buffer.from(placeholderOnly));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/skipped/i);
  });

  it('warns when no records can be detected at all', async () => {
    const wrongPdf = `Some random PDF text with no GestCom records.
${'Padding text to cross the 200-char threshold. '.repeat(10)}`;
    const result = await adapter.parse(Buffer.from(wrongPdf));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/no.*records.*detected/i);
  });

  it('recovers records that omit the "Domeniu de utilizare:" line', async () => {
    // Real GestCom exports sometimes skip the Domeniu line — only the
    // contact form fields appear (Andine Justinian example). The
    // splitter falls back on orphan-Nume anchors.
    const noDomeniu = `Andine Justinian - constanta (2)
RADIATOARE SITE 100 ANULATA radu.oltean CONSTANTA RENOVARE 31.01.2025 -
a blocat apelurile,lucrarea anulata
casa 100 mp
ct gaz+radiatoare si in baie are incalzire in pardoseala.
Nume: Andone
Prenume: Justinian
Email: justi_33@yahoo.com
Telefon: 0722392497
Suprafata: 100
Oras: Constanta
Sologon Sorin - Botosani (3)
RADIATOARE SITE 200 VALABILA radu.oltean BOTOSANI RENOVARE 22.10.2025 -
Domeniu de utilizare: AMASS.RO
Nume: SOLOGON
Prenume: Sorin
Email: Sologon.sorin1967@gmail.com
Telefon: 0741177157
Suprafata: 200
Oras: BOTOȘANI
${'padding to cross 200-char min text gate. '.repeat(3)}`;
    const result = await adapter.parse(Buffer.from(noDomeniu));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!['Nume']).toBe('Andone');
    expect(result.rows[0]!['Email']).toBe('justi_33@yahoo.com');
    expect(result.rows[1]!['Nume']).toBe('SOLOGON');
    expect(result.rows[1]!['Email']).toBe('Sologon.sorin1967@gmail.com');
  });
});

describe('GestCom parser helpers', () => {
  it('splitIntoRecordBlocks anchors on "Domeniu de utilizare:"', () => {
    const blocks = splitIntoRecordBlocks(SAMPLE_TWO_RECORDS);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('Andone');
    expect(blocks[1]).toContain('SOLOGON');
  });

  it('parseRecord extracts contact fields with diacritics', () => {
    const row = parseRecord(SAMPLE_RECORD);
    expect(row['Nume']).toBe('SOLOGON');
    expect(row['Oras']).toMatch(/BOTOȘANI|BOTOSANI/);
  });
});
