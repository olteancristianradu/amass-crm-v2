import { describe, expect, it } from 'vitest';
import { listAdapters, pickAdapter } from './factory';

describe('importer adapter factory', () => {
  it('picks CSV for .csv', () => {
    const a = pickAdapter({ mimeType: 'text/csv', fileName: 'clients.csv' });
    expect(a?.id).toBe('csv');
  });

  it('picks CSV for .tsv', () => {
    const a = pickAdapter({ mimeType: 'text/tab-separated-values', fileName: 'data.tsv' });
    expect(a?.id).toBe('csv');
  });

  it('picks Excel for .xlsx', () => {
    const a = pickAdapter({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'export.xlsx',
    });
    expect(a?.id).toBe('excel');
  });

  it('picks Excel for .xls', () => {
    const a = pickAdapter({ mimeType: 'application/vnd.ms-excel', fileName: 'old.xls' });
    expect(a?.id).toBe('excel');
  });

  it('picks SmartBill for filenames matching SmartBill pattern', () => {
    const a = pickAdapter({ mimeType: 'application/xml', fileName: 'smartbill-export-2026.xml' });
    expect(a?.id).toBe('smartbill');
  });

  it('picks SAGA for filenames matching SAGA pattern', () => {
    const a = pickAdapter({ mimeType: 'text/csv', fileName: 'saga-clienti.csv' });
    expect(a?.id).toBe('saga');
  });

  it('picks PDF for .pdf', () => {
    const a = pickAdapter({ mimeType: 'application/pdf', fileName: 'invoice.pdf' });
    expect(a?.id).toBe('pdf');
  });

  it('returns null for unknown formats', () => {
    const a = pickAdapter({ mimeType: 'application/octet-stream', fileName: 'mystery.bin' });
    expect(a).toBeNull();
  });

  it('lists all registered adapters with stable ids', () => {
    const list = listAdapters();
    const ids = list.map((a) => a.id);
    expect(ids).toEqual(['saga', 'smartbill', 'csv', 'excel', 'pdf']);
    for (const adapter of list) {
      expect(adapter.label).toBeTruthy();
    }
  });
});

describe('CSV adapter parse', () => {
  it('parses a comma-delimited CSV with Romanian-style headers', async () => {
    const { CsvAdapter } = await import('./csv.adapter');
    const csv = 'Nume,Prenume,Email\nPopescu,Ion,ion@example.ro\nIonescu,Maria,maria@example.ro\n';
    const adapter = new CsvAdapter();
    const result = await adapter.parse(Buffer.from(csv, 'utf8'));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ Nume: 'Popescu', Prenume: 'Ion', Email: 'ion@example.ro' });
  });

  it('strips UTF-8 BOM from header', async () => {
    const { CsvAdapter } = await import('./csv.adapter');
    const csv = '﻿Nume,Email\nTest,t@x.ro\n';
    const adapter = new CsvAdapter();
    const result = await adapter.parse(Buffer.from(csv, 'utf8'));
    expect(Object.keys(result.rows[0]!)).toEqual(['Nume', 'Email']);
  });

  it('skips fully empty rows (Excel "save as csv" trailing)', async () => {
    const { CsvAdapter } = await import('./csv.adapter');
    const csv = 'A,B\n1,2\n\n,\n3,4\n';
    const adapter = new CsvAdapter();
    const result = await adapter.parse(Buffer.from(csv, 'utf8'));
    expect(result.rows).toHaveLength(2);
  });
});
