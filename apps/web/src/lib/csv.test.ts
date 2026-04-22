import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { downloadCsv } from './csv';

/**
 * Browser-dependent — we mock URL.createObjectURL + anchor.click().
 * The test validates two things:
 *   1. Values that contain commas/quotes/newlines get wrapped in quotes
 *      and embedded quotes doubled, per RFC 4180.
 *   2. Empty input exits early without side effects (no blob, no click).
 */
describe('downloadCsv', () => {
  let created: BlobPart[][];
  let clicked: boolean;

  beforeEach(() => {
    created = [];
    clicked = false;
    vi.stubGlobal('Blob', class MockBlob {
      constructor(parts: BlobPart[]) { created.push(parts); }
    } as unknown as typeof Blob);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(document, 'createElement').mockImplementation(
      () => ({ href: '', download: '', click: () => { clicked = true; } } as unknown as HTMLElement),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is a no-op on empty input', () => {
    downloadCsv([], 'foo.csv');
    expect(created).toHaveLength(0);
    expect(clicked).toBe(false);
  });

  it('emits one header row + one row per object', () => {
    downloadCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }], 'x.csv');
    const body = (created[0]?.[0] as string | undefined) ?? '';
    expect(body.split('\n')).toEqual(['a,b', '1,2', '3,4']);
  });

  it('quotes values that contain commas + doubles embedded quotes', () => {
    downloadCsv([{ name: 'Acme, Inc.', quote: 'He said "hi"' }], 'x.csv');
    const body = (created[0]?.[0] as string | undefined) ?? '';
    expect(body).toContain('"Acme, Inc."');
    expect(body).toContain('"He said ""hi"""');
  });

  it('treats null/undefined as empty string', () => {
    downloadCsv([{ a: null, b: undefined, c: 'ok' }], 'x.csv');
    const body = (created[0]?.[0] as string | undefined) ?? '';
    expect(body.split('\n')[1]).toBe(',,ok');
  });
});
