import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn()', () => {
  it('joins simple class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('filters falsy values (clsx behaviour)', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('accepts conditional objects', () => {
    expect(cn({ a: true, b: false, c: 1 })).toBe('a c');
  });

  it('dedupes conflicting Tailwind utilities (tailwind-merge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('preserves non-conflicting utilities together', () => {
    expect(cn('p-2', 'm-4')).toBe('p-2 m-4');
  });
});
