/**
 * Envelope encryption for webhook signing secrets (Phase 1 F3, T-WH-T-06).
 *
 * Why "envelope" + AES-256-GCM:
 *   - Postgres at-rest encryption protects backups and disk theft, but a DB
 *     read (SQLi, replica leak, ops query) returns plaintext.
 *   - The legacy `webhook_endpoints.secret` column is plaintext for the 30d
 *     migration window. This service wraps each secret with a server-side KEK
 *     so dual-write produces a `secret_encrypted` column that the DB alone
 *     cannot decrypt — a snapshot leaker also needs `WEBHOOK_SECRET_KEK`.
 *   - GCM provides authenticated encryption: tampering with the ciphertext
 *     flips the tag verification and `decrypt()` throws — defends against an
 *     attacker who can write to the DB but not to env.
 *
 * Format: base64( iv(12) | tag(16) | ciphertext ) — single column, no separator
 * bookkeeping. The `kid` is persisted in a sibling column (`secret_kid`) so we
 * know which KEK wrapped this row without having to try-each on rotation.
 *
 * KEK rotation strategy (Phase 1.6):
 *   1. Generate new KEK + KID. Set `WEBHOOK_SECRET_KEK_2 = ...` and
 *      `WEBHOOK_SECRET_KEK_KID_2 = ...`.
 *   2. EnvelopeService gains a "keyring" — decrypts try `kid` lookup over all
 *      known KEKs.
 *   3. Re-encrypt sweep job walks WebhookEndpoint rows where
 *      secret_kid != current and rewraps in-place.
 *   4. Once sweep done, demote old KEK from env.
 *
 * For Phase 1 we only need the single-KEK happy path — keyring lookup is a
 * Phase 1.6 follow-up.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../../config/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export interface EnvelopeCiphertext {
  ciphertext: string;
  kid: string;
}

@Injectable()
export class EnvelopeService {
  /**
   * Returns the active KEK as a 32-byte Buffer. In dev/test where the env var
   * is unset, derives a deterministic 32-byte key from a constant input —
   * NOT secure, but lets unit specs round-trip without extra wiring. Prod
   * validation (env.ts → prodOnlyChecks) rejects an unset KEK, so the test
   * fallback can never reach a deployed instance.
   */
  private getKek(): Buffer {
    const env = loadEnv();
    const raw = env.WEBHOOK_SECRET_KEK;
    if (raw) {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length !== 32) {
        throw new Error(
          `WEBHOOK_SECRET_KEK must decode to exactly 32 bytes (got ${buf.length})`,
        );
      }
      return buf;
    }
    // Dev/test deterministic fallback. SHA-256 of a known string → 32 bytes.
    // Anyone with the source can compute this; that is acceptable because the
    // prod validator above refuses to boot without a real KEK.
    return createHash('sha256').update('amass-webhook-kek-dev-fallback').digest();
  }

  /** Returns the kid label paired with the active KEK. */
  private getKid(): string {
    return loadEnv().WEBHOOK_SECRET_KEK_KID;
  }

  /**
   * Wrap a plaintext webhook secret. Returns the ciphertext to persist in
   * `webhook_endpoints.secret_encrypted` and the `kid` to persist alongside
   * in `secret_kid`. Both fields are required to decrypt later — losing the
   * `kid` is recoverable today (one KEK) but will not be after Phase 1.6.
   */
  encrypt(plaintext: string): EnvelopeCiphertext {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('EnvelopeService.encrypt: plaintext must be a non-empty string');
    }
    const kek = this.getKek();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, kek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, ct]).toString('base64');
    return { ciphertext: packed, kid: this.getKid() };
  }

  /**
   * Unwrap a ciphertext produced by {@link encrypt}. Throws if:
   *   - the `kid` doesn't match the active KEK (Phase 1.6: keyring lookup)
   *   - the GCM tag fails verification (tamper or wrong key)
   *   - the buffer is shorter than IV+TAG (malformed input)
   */
  decrypt(ciphertext: string, kid: string): string {
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
      throw new Error('EnvelopeService.decrypt: ciphertext must be a non-empty string');
    }
    if (kid !== this.getKid()) {
      // Phase 1.6 will swap this for a keyring lookup. Today the single-KEK
      // assumption means a mismatched kid is a hard error — we'd produce
      // garbage on GCM tag check anyway, this just gives a clearer message.
      throw new Error(
        `EnvelopeService.decrypt: unknown kid "${kid}" (active="${this.getKid()}")`,
      );
    }
    const kek = this.getKek();
    const buf = Buffer.from(ciphertext, 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) {
      throw new Error('EnvelopeService.decrypt: ciphertext too short');
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
