import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { _resetEnvCacheForTests } from '../../config/env';
import { EnvelopeService } from './envelope.service';

const ORIGINAL_ENV = { ...process.env };

function resetEnvTo(overrides: Record<string, string | undefined>): void {
  // Restore process.env then apply overrides so each test gets a fresh slate.
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
  // process.env coerces `= undefined` to the string "undefined". Delete instead
  // when an override explicitly wants the variable unset.
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetEnvCacheForTests();
}

describe('EnvelopeService', () => {
  let svc: EnvelopeService;

  beforeEach(() => {
    // Dev fallback path — no KEK set, deterministic SHA-256 derived key.
    resetEnvTo({ WEBHOOK_SECRET_KEK: undefined, WEBHOOK_SECRET_KEK_KID: 'kek-test' });
    svc = new EnvelopeService();
  });

  describe('encrypt → decrypt round-trip', () => {
    it('recovers the original plaintext under the dev fallback KEK', () => {
      const plain = 'abc123-secret-hex';
      const { ciphertext, kid } = svc.encrypt(plain);
      expect(kid).toBe('kek-test');
      expect(svc.decrypt(ciphertext, kid)).toBe(plain);
    });

    it('produces a different ciphertext for the same input (random IV)', () => {
      const plain = 'same-plaintext';
      const a = svc.encrypt(plain);
      const b = svc.encrypt(plain);
      expect(a.ciphertext).not.toBe(b.ciphertext);
      expect(svc.decrypt(a.ciphertext, a.kid)).toBe(plain);
      expect(svc.decrypt(b.ciphertext, b.kid)).toBe(plain);
    });

    it('round-trips a 64-char hex secret (the actual webhook secret shape)', () => {
      const hexSecret = randomBytes(32).toString('hex');
      const { ciphertext, kid } = svc.encrypt(hexSecret);
      expect(svc.decrypt(ciphertext, kid)).toBe(hexSecret);
    });
  });

  describe('encrypt validation', () => {
    it('rejects empty plaintext', () => {
      expect(() => svc.encrypt('')).toThrow(/non-empty string/);
    });
  });

  describe('decrypt validation', () => {
    it('rejects empty ciphertext', () => {
      expect(() => svc.decrypt('', 'kek-test')).toThrow(/non-empty/);
    });

    it('rejects a kid that does not match the active KEK', () => {
      const { ciphertext } = svc.encrypt('payload');
      expect(() => svc.decrypt(ciphertext, 'kek-other')).toThrow(/unknown kid/);
    });

    it('rejects truncated ciphertext (shorter than IV+TAG)', () => {
      // 27 bytes < 12 (IV) + 16 (TAG) + 1 (min ct).
      const tiny = Buffer.alloc(27).toString('base64');
      expect(() => svc.decrypt(tiny, 'kek-test')).toThrow(/too short/);
    });

    it('rejects tampered ciphertext (GCM auth tag fails)', () => {
      const { ciphertext, kid } = svc.encrypt('payload');
      const buf = Buffer.from(ciphertext, 'base64');
      // Flip a bit in the ciphertext portion (after IV+TAG).
      buf[28] = buf[28] ^ 0x01;
      const tampered = buf.toString('base64');
      expect(() => svc.decrypt(tampered, kid)).toThrow();
    });
  });

  describe('with explicit KEK from env', () => {
    it('uses the configured 32-byte base64 KEK and rejects wrong-length', () => {
      // 32 bytes valid.
      resetEnvTo({
        WEBHOOK_SECRET_KEK: randomBytes(32).toString('base64'),
        WEBHOOK_SECRET_KEK_KID: 'kek-prod-1',
      });
      const s = new EnvelopeService();
      const { ciphertext, kid } = s.encrypt('payload');
      expect(kid).toBe('kek-prod-1');
      expect(s.decrypt(ciphertext, kid)).toBe('payload');
    });

    it('throws when KEK does not decode to 32 bytes', () => {
      // 16 bytes — half what AES-256 needs.
      resetEnvTo({
        WEBHOOK_SECRET_KEK: randomBytes(16).toString('base64'),
        WEBHOOK_SECRET_KEK_KID: 'kek-bad',
      });
      const s = new EnvelopeService();
      expect(() => s.encrypt('payload')).toThrow(/32 bytes/);
    });
  });

  describe('cross-instance compatibility', () => {
    it('two service instances with the same KEK can decrypt each other', () => {
      const kek = randomBytes(32).toString('base64');
      resetEnvTo({ WEBHOOK_SECRET_KEK: kek, WEBHOOK_SECRET_KEK_KID: 'kek-shared' });
      const a = new EnvelopeService();
      const b = new EnvelopeService();
      const wrapped = a.encrypt('shared-secret');
      expect(b.decrypt(wrapped.ciphertext, wrapped.kid)).toBe('shared-secret');
    });
  });
});
