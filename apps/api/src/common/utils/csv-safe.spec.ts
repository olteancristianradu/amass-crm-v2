import { describe, expect, it } from 'vitest';
import { sanitizeCsvCell, sanitizeCsvRow } from './csv-safe';

describe('sanitizeCsvCell', () => {
  it('prefixes = with a tick (formula)', () => {
    expect(sanitizeCsvCell('=HYPERLINK("https://evil.com","X")')).toBe(
      "'=HYPERLINK(\"https://evil.com\",\"X\")",
    );
  });

  it('prefixes + / - / @ (Excel formula triggers)', () => {
    expect(sanitizeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(sanitizeCsvCell('-1+1')).toBe("'-1+1");
    expect(sanitizeCsvCell('@sheet')).toBe("'@sheet");
  });

  it('prefixes tab and CR (leading-whitespace bypass)', () => {
    expect(sanitizeCsvCell('\t=cmd')).toBe("'\t=cmd");
    expect(sanitizeCsvCell('\r=cmd')).toBe("'\r=cmd");
  });

  it('leaves safe strings alone', () => {
    expect(sanitizeCsvCell('Hello, world')).toBe('Hello, world');
    expect(sanitizeCsvCell('name@example.com')).toBe('name@example.com'); // @ only dangerous at start
    expect(sanitizeCsvCell('-5')).toBe("'-5"); // but leading minus IS dangerous
  });

  it('passes through non-string values (numbers, booleans, Date)', () => {
    expect(sanitizeCsvCell(42)).toBe(42);
    expect(sanitizeCsvCell(true)).toBe(true);
    const d = new Date();
    expect(sanitizeCsvCell(d)).toBe(d);
  });

  it('empty string untouched (no false positive)', () => {
    expect(sanitizeCsvCell('')).toBe('');
  });
});

describe('sanitizeCsvRow', () => {
  it('walks every key in the row', () => {
    const out = sanitizeCsvRow({
      firstName: '=evil',
      lastName: 'Popescu',
      age: 30,
      notes: '+cmd',
    });
    expect(out.firstName).toBe("'=evil");
    expect(out.lastName).toBe('Popescu');
    expect(out.age).toBe(30);
    expect(out.notes).toBe("'+cmd");
  });
});
