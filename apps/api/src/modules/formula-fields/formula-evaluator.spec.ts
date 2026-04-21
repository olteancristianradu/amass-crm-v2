import { describe, expect, it } from 'vitest';
import { evaluateFormula } from './formula-evaluator';

describe('evaluateFormula — arithmetic', () => {
  it('adds numbers', () => expect(evaluateFormula('1 + 2', {})).toBe(3));
  it('respects * over +', () => expect(evaluateFormula('2 + 3 * 4', {})).toBe(14));
  it('respects parentheses', () => expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20));
  it('supports unary minus', () => expect(evaluateFormula('-5 + 2', {})).toBe(-3));
  it('supports unary plus', () => expect(evaluateFormula('+5', {})).toBe(5));
  it('divides', () => expect(evaluateFormula('10 / 4', {})).toBe(2.5));
  it('throws on division by zero', () =>
    expect(() => evaluateFormula('1 / 0', {})).toThrow(/zero/i));
});

describe('evaluateFormula — string ops', () => {
  it('concatenates with + when either side non-numeric', () => {
    expect(evaluateFormula('"Hello, " + name', { name: 'World' })).toBe('Hello, World');
  });
  it('CONCAT joins all args', () => {
    expect(evaluateFormula('CONCAT("a", "b", "c")', {})).toBe('abc');
  });
  it('UPPER/LOWER/TRIM/LEN work', () => {
    expect(evaluateFormula('UPPER("ab")', {})).toBe('AB');
    expect(evaluateFormula('LOWER("AB")', {})).toBe('ab');
    expect(evaluateFormula('TRIM("  x  ")', {})).toBe('x');
    expect(evaluateFormula('LEN("abcd")', {})).toBe(4);
  });
});

describe('evaluateFormula — comparisons & booleans', () => {
  it('supports =, !=, <, >, <=, >=', () => {
    expect(evaluateFormula('5 = 5', {})).toBe(true);
    expect(evaluateFormula('5 != 6', {})).toBe(true);
    expect(evaluateFormula('5 < 6', {})).toBe(true);
    expect(evaluateFormula('5 <= 5', {})).toBe(true);
    expect(evaluateFormula('6 > 5', {})).toBe(true);
    expect(evaluateFormula('5 >= 5', {})).toBe(true);
  });

  it('lexicographic compare for strings', () => {
    expect(evaluateFormula('"abc" < "abd"', {})).toBe(true);
  });

  it('TRUE/FALSE literals', () => {
    expect(evaluateFormula('TRUE', {})).toBe(true);
    expect(evaluateFormula('FALSE', {})).toBe(false);
  });

  it('AND/OR/NOT short-circuit via truthy()', () => {
    expect(evaluateFormula('TRUE AND FALSE', {})).toBe(false);
    expect(evaluateFormula('FALSE OR TRUE', {})).toBe(true);
    expect(evaluateFormula('NOT FALSE', {})).toBe(true);
    expect(evaluateFormula('NOT NOT TRUE', {})).toBe(true);
  });
});

describe('evaluateFormula — builtins', () => {
  it('IF picks branch', () => {
    expect(evaluateFormula('IF(1 > 0, "yes", "no")', {})).toBe('yes');
    expect(evaluateFormula('IF(1 < 0, "yes", "no")', {})).toBe('no');
  });

  it('MIN/MAX/ABS', () => {
    expect(evaluateFormula('MIN(3, 1, 2)', {})).toBe(1);
    expect(evaluateFormula('MAX(3, 1, 2)', {})).toBe(3);
    expect(evaluateFormula('ABS(-7)', {})).toBe(7);
  });

  it('ROUND', () => {
    expect(evaluateFormula('ROUND(1.6)', {})).toBe(2);
    expect(evaluateFormula('ROUND(1.4)', {})).toBe(1);
  });

  it('COALESCE returns first non-empty', () => {
    expect(evaluateFormula('COALESCE("", missing, "fallback")', {})).toBe('fallback');
    expect(evaluateFormula('COALESCE("first", "second")', {})).toBe('first');
  });

  it('function names are case-insensitive', () => {
    expect(evaluateFormula('upper("hi")', {})).toBe('HI');
    expect(evaluateFormula('If(true, 1, 2)', {})).toBe(1);
  });

  it('throws on unknown function', () => {
    expect(() => evaluateFormula('MYSTERY(1)', {})).toThrow(/Unknown function/);
  });
});

describe('evaluateFormula — variables & errors', () => {
  it('resolves variables from context', () => {
    expect(evaluateFormula('price * qty', { price: 10, qty: 3 })).toBe(30);
  });

  it('missing variables default to empty string', () => {
    expect(evaluateFormula('ghost', {})).toBe('');
  });

  it('throws on unterminated string', () => {
    expect(() => evaluateFormula('"oops', {})).toThrow(/Unterminated/);
  });

  it('throws on trailing input', () => {
    expect(() => evaluateFormula('1 2', {})).toThrow(/trailing/i);
  });

  it('throws on unmatched paren', () => {
    expect(() => evaluateFormula('(1 + 2', {})).toThrow(/\)/);
  });
});
