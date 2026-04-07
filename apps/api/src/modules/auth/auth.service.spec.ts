import { describe, expect, it } from 'vitest';
import { hashToken } from './auth.service';

describe('hashToken', () => {
  it('produces deterministic SHA-256 hex', () => {
    const a = hashToken('hello');
    const b = hashToken('hello');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
