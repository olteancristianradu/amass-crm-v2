import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock loadEnv to feed a stable 64-hex (32-byte) ENCRYPTION_KEY. The
// real key in dev is supplied via .env.example / docker-compose; tests
// must NOT depend on the host env.
const TEST_KEY = 'a'.repeat(64); // 32 bytes of 0xAA
vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({ ENCRYPTION_KEY: TEST_KEY })),
}));

import { encrypt, decrypt } from './encryption';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AES-256-GCM encryption helpers', () => {
  it('round-trips a UTF-8 string through encrypt → decrypt', () => {
    const plaintext = 'Andrei Popescu — andrei@firma.ro / parola: hunter2';
    const encoded = encrypt(plaintext);
    expect(decrypt(encoded)).toBe(plaintext);
  });

  it('produces a different ciphertext on every call (fresh IV per encrypt)', () => {
    const plaintext = 'same input';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('emits base64 output with the documented (iv 12 + tag 16 + ct) layout', () => {
    const encoded = encrypt('hello');
    const buf = Buffer.from(encoded, 'base64');
    // 12 (IV) + 16 (tag) + 5 (UTF-8 "hello") = 33 bytes
    expect(buf.length).toBe(12 + 16 + 5);
  });

  it('rejects tampered ciphertext (auth tag mismatch → throws)', () => {
    const encoded = encrypt('sensitive');
    const buf = Buffer.from(encoded, 'base64');
    // Flip a bit in the ciphertext portion (after iv+tag).
    buf[12 + 16] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects tampered auth tag (auth tag mismatch → throws)', () => {
    const encoded = encrypt('sensitive');
    const buf = Buffer.from(encoded, 'base64');
    // Flip a bit inside the GCM auth tag (bytes 12..27).
    buf[20] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('handles empty string correctly', () => {
    const encoded = encrypt('');
    expect(decrypt(encoded)).toBe('');
  });

  it('handles unicode (Romanian diacritics) correctly', () => {
    const plaintext = 'mărțișor: ăâîșțĂÂÎȘȚ';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
