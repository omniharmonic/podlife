/**
 * Token hashing helpers. We use bcrypt for tokens that are stored in the
 * database. The plaintext token is sent to the user via email or URL;
 * only the hash is stored, so a DB compromise doesn't yield usable tokens.
 */
import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, ROUNDS);
}

export async function verifyToken(token: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(token, hash);
  } catch {
    return false;
  }
}
