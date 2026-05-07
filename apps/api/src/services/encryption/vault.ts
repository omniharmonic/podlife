/**
 * AES-256-GCM vault for OAuth tokens and other secrets at rest.
 * Per arch § 13.1.
 *
 * Format: [iv(16)][authTag(16)][ciphertext]
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../../lib/config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

const KEY = Buffer.from(config.encryptionKey, 'hex');
if (KEY.length !== 32) {
  throw new Error(`ENCRYPTION_KEY must decode to exactly 32 bytes; got ${KEY.length}`);
}

export function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decrypt(data: Buffer): string {
  if (data.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('vault: payload too short');
  }
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = data.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
