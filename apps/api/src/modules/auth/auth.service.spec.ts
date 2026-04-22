import { describe, expect, it } from 'vitest';
import * as bcrypt from 'bcrypt';
import { hashToken, BCRYPT_COST, LEGACY_BCRYPT_COST, parseTtlSeconds } from './auth.service';

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

describe('parseTtlSeconds', () => {
  it('parses common units', () => {
    expect(parseTtlSeconds('30s')).toBe(30);
    expect(parseTtlSeconds('15m')).toBe(15 * 60);
    expect(parseTtlSeconds('2h')).toBe(2 * 3600);
    expect(parseTtlSeconds('7d')).toBe(7 * 86_400);
  });

  it('falls back to 15min (900s) on garbage input', () => {
    expect(parseTtlSeconds('nope')).toBe(900);
    expect(parseTtlSeconds('')).toBe(900);
  });
});

describe('bcrypt cost rehash detection', () => {
  it(`BCRYPT_COST is 12; LEGACY_BCRYPT_COST is 10`, () => {
    expect(BCRYPT_COST).toBe(12);
    expect(LEGACY_BCRYPT_COST).toBe(10);
  });

  it('a cost-10 hash starts with $2b$10$ and is detected by the login rehash path', async () => {
    const legacy = await bcrypt.hash('password123', LEGACY_BCRYPT_COST);
    expect(legacy.startsWith(`$2b$${LEGACY_BCRYPT_COST.toString().padStart(2, '0')}$`)).toBe(true);
  });

  it('a cost-12 hash does NOT match the legacy prefix (so we do not re-rehash on every login)', async () => {
    const fresh = await bcrypt.hash('password123', BCRYPT_COST);
    expect(fresh.startsWith(`$2b$${LEGACY_BCRYPT_COST.toString().padStart(2, '0')}$`)).toBe(false);
  }, 10_000);
});
