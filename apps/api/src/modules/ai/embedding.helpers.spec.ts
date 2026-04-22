import { describe, expect, it } from 'vitest';
import { toVectorLiteral, truncateForEmbedding } from './embedding.helpers';

describe('toVectorLiteral', () => {
  it('formats a short vector with no whitespace', () => {
    expect(toVectorLiteral([1.2, 3.4, 5.6])).toBe('[1.2,3.4,5.6]');
  });

  it('handles empty vectors (edge case: provider returned nothing)', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });

  it('round-trips negative + high-precision floats', () => {
    expect(toVectorLiteral([-0.00123, 2.71828, 0])).toBe('[-0.00123,2.71828,0]');
  });
});

describe('truncateForEmbedding', () => {
  it('leaves short inputs untouched', () => {
    expect(truncateForEmbedding('hello')).toBe('hello');
  });

  it('clamps at the default 8192 chars', () => {
    const huge = 'a'.repeat(10_000);
    expect(truncateForEmbedding(huge)).toHaveLength(8192);
  });

  it('honours an explicit max parameter', () => {
    expect(truncateForEmbedding('abcdefg', 3)).toBe('abc');
  });
});
