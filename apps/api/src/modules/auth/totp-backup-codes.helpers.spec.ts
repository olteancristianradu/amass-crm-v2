import { describe, expect, it } from 'vitest';
import {
  BACKUP_CODE_COUNT,
  BACKUP_CODE_LENGTH,
  consumeBackupCode,
  generateBackupCodes,
  hashBackupCode,
} from './totp-backup-codes.helpers';

describe('generateBackupCodes', () => {
  it(`returns ${BACKUP_CODE_COUNT} codes by default`, () => {
    const { raw, hashes } = generateBackupCodes();
    expect(raw.length).toBe(BACKUP_CODE_COUNT);
    expect(hashes.length).toBe(BACKUP_CODE_COUNT);
  });

  it(`each code is exactly ${BACKUP_CODE_LENGTH} chars from [a-z0-9]`, () => {
    const { raw } = generateBackupCodes(5);
    for (const c of raw) {
      expect(c.length).toBe(BACKUP_CODE_LENGTH);
      expect(c).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('hashes match hashBackupCode(raw)', () => {
    const { raw, hashes } = generateBackupCodes(3);
    for (let i = 0; i < raw.length; i++) {
      expect(hashes[i]).toBe(hashBackupCode(raw[i]));
    }
  });

  it('two generations produce different codes (no fixed seed)', () => {
    const a = generateBackupCodes(3);
    const b = generateBackupCodes(3);
    expect(a.raw).not.toEqual(b.raw);
  });
});

describe('hashBackupCode', () => {
  it('normalises whitespace and case', () => {
    expect(hashBackupCode('  ABC123  ')).toBe(hashBackupCode('abc123'));
  });

  it('produces a 64-char hex digest', () => {
    expect(hashBackupCode('abc123xy')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('consumeBackupCode', () => {
  const { raw, hashes } = generateBackupCodes(3);

  it('returns matched=true + remaining hashes when code matches', () => {
    const out = consumeBackupCode(raw[1], hashes);
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.remaining.length).toBe(2);
      expect(out.remaining).toEqual([hashes[0], hashes[2]]);
    }
  });

  it('returns matched=false when the code is unknown / already used', () => {
    const out = consumeBackupCode('nosuchab', hashes);
    expect(out.matched).toBe(false);
  });

  it('is case-insensitive + whitespace-tolerant', () => {
    const out = consumeBackupCode(`  ${raw[0].toUpperCase()}  `, hashes);
    expect(out.matched).toBe(true);
  });

  it('one-time: re-using the same code on remaining list fails', () => {
    const first = consumeBackupCode(raw[0], hashes);
    if (!first.matched) throw new Error('first consume must succeed');
    const second = consumeBackupCode(raw[0], first.remaining);
    expect(second.matched).toBe(false);
  });
});
