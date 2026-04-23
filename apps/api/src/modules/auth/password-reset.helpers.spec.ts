import { describe, expect, it } from 'vitest';
import {
  TOKEN_BYTES,
  generateToken,
  hashToken,
  isTokenUsable,
  tokenTtl,
} from './password-reset.helpers';

describe('generateToken', () => {
  it('returns a raw token + its SHA-256 digest', () => {
    const pair = generateToken();
    expect(pair.raw).toBeTypeOf('string');
    expect(pair.hash).toBeTypeOf('string');
    expect(pair.hash).toBe(hashToken(pair.raw));
  });

  it('raw token is URL-safe base64 (no +/= padding characters)', () => {
    const { raw } = generateToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two consecutive tokens differ (no CSPRNG regression)', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it(`raw token has at least ${TOKEN_BYTES} bytes of entropy (b64url length ≥ ceil(32/3)*4 - padding)`, () => {
    const { raw } = generateToken();
    // 32 bytes base64url-encoded = 43 characters (no padding).
    expect(raw.length).toBeGreaterThanOrEqual(43);
  });
});

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produces a 64-char hex digest (SHA-256 → 256 bits → 64 hex)', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tokenTtl', () => {
  it('returns a date N minutes in the future', () => {
    const before = Date.now();
    const ttl = tokenTtl(60);
    const diff = ttl.getTime() - before;
    // allow ±5s for test scheduling jitter
    expect(diff).toBeGreaterThan(60 * 60_000 - 5_000);
    expect(diff).toBeLessThan(60 * 60_000 + 5_000);
  });
});

describe('isTokenUsable', () => {
  const future = new Date(Date.now() + 3600_000);
  const past = new Date(Date.now() - 60_000);

  it('returns true for a fresh unused token', () => {
    expect(isTokenUsable({ usedAt: null, expiresAt: future })).toBe(true);
  });

  it('returns false when already used (replay guard)', () => {
    expect(isTokenUsable({ usedAt: new Date(), expiresAt: future })).toBe(false);
  });

  it('returns false when expired', () => {
    expect(isTokenUsable({ usedAt: null, expiresAt: past })).toBe(false);
  });
});
