import { createHash, randomBytes } from 'node:crypto';

/**
 * One-time bearer tokens for password reset + email verification.
 *
 * Pattern:
 *   1. We generate a cryptographically-random token (TOKEN_BYTES bytes, b64url).
 *   2. Mail it to the user.
 *   3. Store only the SHA-256 digest in the DB so a DB dump cannot be used
 *      to reset anyone's password.
 *   4. On consumption, hash the submitted token the same way and look it
 *      up in the DB. Mark `usedAt` atomically to prevent replay.
 *
 * TTL is caller-decided (password reset = 60min, email verify = 24h).
 */

export const TOKEN_BYTES = 32; // 256 bit — plenty of entropy

export interface TokenPair {
  /** The raw token — mail this to the user, never log it. */
  raw: string;
  /** The SHA-256 digest — store this in the DB. */
  hash: string;
}

export function generateToken(): TokenPair {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function tokenTtl(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Predicate: is a token row usable right now? Caller should wrap the
 * consumption in a transaction that also UPDATEs usedAt.
 */
export function isTokenUsable(row: { usedAt: Date | null; expiresAt: Date }, now: Date = new Date()): boolean {
  if (row.usedAt !== null) return false;
  if (row.expiresAt.getTime() < now.getTime()) return false;
  return true;
}
