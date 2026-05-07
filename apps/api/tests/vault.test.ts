import { describe, expect, it } from 'vitest';
import { encrypt, decrypt } from '../src/services/encryption/vault.js';

describe('vault', () => {
  it('round-trips a string', () => {
    const plaintext = 'oauth-access-token-abc-123';
    const blob = encrypt(plaintext);
    expect(blob.length).toBeGreaterThan(32);
    expect(decrypt(blob)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  it('rejects tampered ciphertext', () => {
    const blob = encrypt('secret');
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0xff;
    expect(() => decrypt(blob)).toThrow();
  });

  it('handles unicode', () => {
    const plaintext = '🔒 hello — café';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
