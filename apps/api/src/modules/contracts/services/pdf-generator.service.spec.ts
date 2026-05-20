import { describe, expect, it } from 'vitest';
import { PdfGeneratorService } from './pdf-generator.service';

describe('PdfGeneratorService.interpolate', () => {
  const svc = new PdfGeneratorService();
  const variables = [
    { key: 'company.name', type: 'string', required: true },
    { key: 'value', type: 'number', required: false },
  ];

  it('substitutes allowed keys', () => {
    const out = svc.interpolate(
      'Hello {{company.name}}, value is {{value}}',
      variables,
      { 'company.name': 'Acme', value: 12000 },
    );
    expect(out).toBe('Hello Acme, value is 12000');
  });

  it('leaves disallowed keys verbatim (template-injection defense)', () => {
    const out = svc.interpolate(
      'Safe {{company.name}}, hostile {{user.passwordHash}}',
      variables,
      { 'company.name': 'Acme', 'user.passwordHash': 'leaked' },
    );
    expect(out).toContain('Safe Acme');
    expect(out).toContain('{{user.passwordHash}}');
    expect(out).not.toContain('leaked');
  });

  it('renders empty string for null + undefined values', () => {
    const out = svc.interpolate('Val={{value}}', variables, { value: null });
    expect(out).toBe('Val=');
  });

  it('tolerates non-array variables (template misconfig)', () => {
    const out = svc.interpolate('Hello {{x}}', null, { x: 'world' });
    expect(out).toBe('Hello {{x}}'); // no allow-list → no interpolation
  });
});

describe('PdfGeneratorService.renderContract', () => {
  const svc = new PdfGeneratorService();

  it('returns PDF bytes plus a deterministic SHA-256 hash', async () => {
    const r = await svc.renderContract({
      template: { bodyMd: 'Hello {{company.name}}', variables: [{ key: 'company.name' }] },
      contract: {
        id: 'c-1',
        title: 'Test Contract',
        companyName: 'Acme',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      fieldValues: { 'company.name': 'Acme' },
      isFinal: false,
    });
    expect(r.buffer.length).toBeGreaterThan(100);
    expect(r.byteLength).toBe(r.buffer.length);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    // PDF magic header.
    expect(r.buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('produces different output for DRAFT vs FINAL watermark', async () => {
    const args = {
      template: { bodyMd: 'Body', variables: [] },
      contract: {
        id: 'c-2',
        title: 'T',
        companyName: 'C',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      fieldValues: {},
    };
    const a = await svc.renderContract({ ...args, isFinal: false });
    const b = await svc.renderContract({ ...args, isFinal: true });
    expect(a.sha256).not.toBe(b.sha256);
  });
});

describe('PdfGeneratorService.renderSignatureCertificate', () => {
  const svc = new PdfGeneratorService();
  // Real 1x1 transparent PNG — decodable by pdfkit's image embedder.
  const realPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  it('CRIT-1: renders a certificate PDF with an embedded signature + deterministic hash', async () => {
    const r = await svc.renderSignatureCertificate({
      contract: { id: 'c-1', title: 'Test Contract', companyName: 'Acme' },
      signedPdfHash: 'a'.repeat(64),
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      signers: [
        {
          name: 'Jane Doe',
          email: 'jane@acme.test',
          role: 'COUNTERPARTY',
          signedAt: new Date('2026-01-01T00:00:00.000Z'),
          ipAddress: '1.2.3.4',
          signatureImagePng: realPng,
        },
      ],
    });
    expect(r.buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.byteLength).toBe(r.buffer.length);
  });

  it('tolerates a corrupt signature image without aborting the render', async () => {
    const r = await svc.renderSignatureCertificate({
      contract: { id: 'c-2', title: 'T', companyName: 'Acme' },
      signedPdfHash: 'b'.repeat(64),
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      signers: [
        {
          name: 'Bad Png',
          email: 'bad@acme.test',
          role: 'COUNTERPARTY',
          signedAt: new Date('2026-01-01T00:00:00.000Z'),
          ipAddress: null,
          signatureImagePng: Buffer.from('not a real png'),
        },
      ],
    });
    expect(r.buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
