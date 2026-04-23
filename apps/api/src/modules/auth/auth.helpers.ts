/**
 * Pure helpers extracted from AuthService — no DB, no Redis, no Nest.
 *
 * Keeping the bcrypt policy + lockout heuristics here means:
 *   - they can be unit-tested without the full auth stack spun up;
 *   - policy changes (e.g. bump BCRYPT_COST to 13, reduce LOCKOUT_TTL)
 *     stay visible in one place.
 */

/**
 * bcrypt cost parameter. 12 is ~250ms on modern hardware — painful enough
 * to slow brute-force, fast enough not to block legit logins.
 */
export const BCRYPT_COST = 12;

/**
 * bcrypt cost used before we bumped the default. Hashes with this cost
 * still verify correctly; `isLegacyBcryptHash` detects them so login can
 * trigger a fire-and-forget rehash at cost=BCRYPT_COST.
 */
export const LEGACY_BCRYPT_COST = 10;

/** After this many consecutive failed logins on an account, lock it. */
export const MAX_LOGIN_ATTEMPTS = 10;

/** Lockout window (and the Redis key TTL for failed-attempt counters). */
export const LOCKOUT_TTL_SECONDS = 15 * 60;

/**
 * bcrypt hashes start with `$2<variant>$<cost>$...`. A legacy cost hash
 * (originally generated with cost 10 before we bumped the default to 12)
 * still verifies correctly — but we want to seamlessly rehash on next
 * successful login to match current policy.
 *
 * Returns true iff the hash was generated with the legacy cost factor.
 */
export function isLegacyBcryptHash(hash: string): boolean {
  const costPrefix = `$2b$${LEGACY_BCRYPT_COST.toString().padStart(2, '0')}$`;
  return hash.startsWith(costPrefix);
}

/** Lockout decision — pure function of the incremented failed-count. */
export function shouldLockAccount(failedAttemptsIncludingThisOne: number): boolean {
  return failedAttemptsIncludingThisOne >= MAX_LOGIN_ATTEMPTS;
}

/**
 * User-facing lockout message. Pure + testable so we can change
 * wording/language without risking lockout math regressions.
 */
export function lockoutMessage(ttlSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  return `Too many failed login attempts. Try again in ${minutes} minute(s).`;
}
