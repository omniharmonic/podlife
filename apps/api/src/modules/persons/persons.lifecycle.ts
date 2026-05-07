/**
 * Account lifecycle helpers (P9.4) — full data cleanup on account deletion.
 *
 * The DB cascades cover all tabled data; this module covers Redis state:
 *   - Free/busy cache entries: podlife:avail:<personId>:*
 *   - Telegram link tokens: podlife:tg-link:<token>  (we scan & match by value)
 *   - Rate limit buckets: podlife:rl:*  (best-effort scan-based purge)
 *
 * Calendar OAuth tokens are stored encrypted in Postgres and are deleted via
 * the calendar_connections cascade on persons.id; no plaintext copy exists.
 */
import { redis, redisFor } from '../../lib/redis.js';

const availKey = redisFor('avail');

/**
 * Purge every Redis key associated with `personId`. Best-effort — uses SCAN
 * (non-blocking) under the hood and tolerates partial failures.
 */
export async function cleanupRedisForPerson(personId: string): Promise<void> {
  const patterns = [
    `${availKey('')}${personId}:*`, // free/busy cache shards for this person
    `${availKey('')}${personId}`, // exact key (no shard suffix)
    `podlife:rl:*:${personId}`, // rate limit buckets keyed by user
  ];
  for (const pattern of patterns) {
    await redis.delByPattern(pattern);
  }
}
