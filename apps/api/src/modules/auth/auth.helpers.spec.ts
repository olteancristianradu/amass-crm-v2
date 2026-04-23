import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import {
  BCRYPT_COST,
  LEGACY_BCRYPT_COST,
  LOCKOUT_TTL_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  isLegacyBcryptHash,
  lockoutMessage,
  shouldLockAccount,
} from './auth.helpers';

describe('isLegacyBcryptHash', () => {
  it('detects a real cost-10 bcrypt hash', async () => {
    // Generate a bcrypt hash with the legacy cost so we aren't testing a
    // hard-coded string — if the detection regex ever drifts from bcrypt's
    // actual output format we want this test to catch it.
    const legacyHash = await bcrypt.hash('pw', LEGACY_BCRYPT_COST);
    expect(isLegacyBcryptHash(legacyHash)).toBe(true);
  });

  it('rejects a current cost-12 hash', async () => {
    const currentHash = await bcrypt.hash('pw', BCRYPT_COST);
    expect(isLegacyBcryptHash(currentHash)).toBe(false);
  });

  it('rejects empty string / random prefix / argon2 hashes', () => {
    expect(isLegacyBcryptHash('')).toBe(false);
    expect(isLegacyBcryptHash('$argon2id$v=19$m=65536,t=3,p=4$...')).toBe(false);
    expect(isLegacyBcryptHash('not-a-hash')).toBe(false);
  });
});

describe('shouldLockAccount', () => {
  it('does not lock before MAX_LOGIN_ATTEMPTS', () => {
    expect(shouldLockAccount(1)).toBe(false);
    expect(shouldLockAccount(MAX_LOGIN_ATTEMPTS - 1)).toBe(false);
  });

  it('locks exactly at MAX_LOGIN_ATTEMPTS (10 by default)', () => {
    expect(shouldLockAccount(MAX_LOGIN_ATTEMPTS)).toBe(true);
  });

  it('stays locked past the threshold', () => {
    expect(shouldLockAccount(MAX_LOGIN_ATTEMPTS + 5)).toBe(true);
  });
});

describe('lockoutMessage', () => {
  it('shows the remaining minutes (ceiling — never undersells wait time)', () => {
    expect(lockoutMessage(30)).toContain('1 minute');
    expect(lockoutMessage(60)).toContain('1 minute');
    expect(lockoutMessage(61)).toContain('2 minute');
  });

  it('never shows "0 minutes" (would be misleading)', () => {
    expect(lockoutMessage(1)).toContain('1 minute');
  });

  it('uses the full policy TTL when asked', () => {
    expect(lockoutMessage(LOCKOUT_TTL_SECONDS)).toContain(`${LOCKOUT_TTL_SECONDS / 60} minute`);
  });
});
