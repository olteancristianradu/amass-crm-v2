import { createHash, randomBytes } from 'node:crypto';

/**
 * TOTP backup codes. If a user loses their authenticator device, a pre-
 * generated list of one-time codes lets them re-authenticate without
 * admin intervention.
 *
 * We follow the pattern used by Google / GitHub:
 *   - 10 codes, each 8 characters of [a-z0-9] (40 bits of entropy each).
 *   - Shown to the user ONCE in plaintext immediately after enrolment.
 *   - Stored as SHA-256 hashes in `User.totpBackupCodes` (JSON array).
 *   - Each code is single-use; on successful login we SPLICE the used
 *     hash out of the stored array atomically.
 *
 * The helpers below are pure (no DB) so they can be unit-tested without
 * the full auth stack.
 */

export const BACKUP_CODE_COUNT = 10;
export const BACKUP_CODE_LENGTH = 8;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): {
  raw: string[];
  hashes: string[];
} {
  const raw: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(BACKUP_CODE_LENGTH);
    let code = '';
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      code += ALPHABET[bytes[j] % ALPHABET.length];
    }
    raw.push(code);
  }
  const hashes = raw.map(hashBackupCode);
  return { raw, hashes };
}

/** Hash a single backup code. Used at enrol-time (batch) and verify-time. */
export function hashBackupCode(code: string): string {
  // Normalise: lower-case + strip whitespace so users can type loosely.
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/**
 * Look up a submitted code against the stored hash list. Returns the
 * REMAINING hashes (with the matched one removed) iff a match exists,
 * or null if no match. Caller persists the remaining list atomically.
 */
export function consumeBackupCode(
  submitted: string,
  storedHashes: string[],
): { matched: true; remaining: string[] } | { matched: false } {
  const h = hashBackupCode(submitted);
  const idx = storedHashes.indexOf(h);
  if (idx < 0) return { matched: false };
  return { matched: true, remaining: [...storedHashes.slice(0, idx), ...storedHashes.slice(idx + 1)] };
}
