/**
 * Constant-time comparison helpers for secrets (bearer tokens, webhook
 * secrets). Avoids the early-return timing side channel of `a === b`.
 */
import { timingSafeEqual } from 'node:crypto';

/** True iff the two strings are byte-equal, in constant time per length. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length is not itself secret; timingSafeEqual requires equal lengths.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
