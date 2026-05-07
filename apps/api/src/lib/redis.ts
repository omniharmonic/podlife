/**
 * Redis adapter — dual-driver.
 *
 * Picks between two backends based on env:
 *   - UPSTASH_REDIS_REST_URL set → @upstash/redis (REST/HTTP, serverless)
 *   - otherwise                   → ioredis (TCP, self-hosted / local Docker)
 *
 * Exposes a small ioredis-shaped surface so existing call sites work
 * unchanged. The methods below cover everything actually used in this
 * codebase; if you need a new Redis op, add it here so both backends
 * stay in sync.
 */
import IORedis, { type Redis as IORedisInstance } from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { config } from './config.js';

export interface RedisAdapter {
  get(key: string): Promise<string | null>;
  /** Set key. If ttlSeconds is provided, sets EX. */
  set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  /** Returns 1 if expiry set, 0 if key didn't exist. */
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  /**
   * Delete every key matching `pattern`. Uses SCAN under the hood (non-blocking)
   * and tolerates partial failures.
   */
  delByPattern(pattern: string): Promise<number>;
  /** Cleanly shut down underlying connection (no-op on REST). */
  shutdown(): Promise<void>;
}

function makeIORedisAdapter(): RedisAdapter {
  const client: IORedisInstance = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[redis] connection error:', err.message);
  });

  return {
    async get(key) {
      return client.get(key);
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined) {
        return client.set(key, value, 'EX', ttlSeconds) as Promise<'OK' | null>;
      }
      return client.set(key, value) as Promise<'OK' | null>;
    },
    async del(...keys) {
      if (keys.length === 0) return 0;
      return client.del(...keys);
    },
    async incr(key) {
      return client.incr(key);
    },
    async expire(key, seconds) {
      return client.expire(key, seconds);
    },
    async ping() {
      return client.ping();
    },
    async delByPattern(pattern) {
      let total = 0;
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          total += await client.del(...keys);
        }
      } while (cursor !== '0');
      return total;
    },
    async shutdown() {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

function makeUpstashAdapter(): RedisAdapter {
  const url = config.upstash.redisUrl;
  const token = config.upstash.redisToken;
  if (!url || !token) {
    throw new Error(
      'Upstash Redis URL/token missing. Set UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN ' +
        '(or the Vercel marketplace alias KV_REST_API_URL+KV_REST_API_TOKEN).',
    );
  }
  const client = new UpstashRedis({ url, token });

  return {
    async get(key) {
      // Upstash auto-deserializes JSON-looking values; force string by reading raw.
      // The SDK's `get` returns `T | null`, where `T` is inferred. We always
      // store strings, so coerce explicitly.
      const v = await client.get<string>(key);
      return v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined) {
        return (await client.set(key, value, { ex: ttlSeconds })) as 'OK' | null;
      }
      return (await client.set(key, value)) as 'OK' | null;
    },
    async del(...keys) {
      if (keys.length === 0) return 0;
      return client.del(...keys);
    },
    async incr(key) {
      return client.incr(key);
    },
    async expire(key, seconds) {
      // Upstash returns boolean-ish 1|0.
      const r = await client.expire(key, seconds);
      return Number(r);
    },
    async ping() {
      return client.ping();
    },
    async delByPattern(pattern) {
      let total = 0;
      let cursor: string | number = 0;
      do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [next, keys] = (await client.scan(cursor, { match: pattern, count: 200 })) as [
          string | number,
          string[],
        ];
        cursor = next;
        if (keys.length > 0) {
          total += await client.del(...keys);
        }
      } while (String(cursor) !== '0');
      return total;
    },
    async shutdown() {
      // REST client — no persistent connection to close.
    },
  };
}

const useUpstash = config.upstash.redisEnabled;

export const redis: RedisAdapter = useUpstash ? makeUpstashAdapter() : makeIORedisAdapter();
export const redisDriver = useUpstash ? 'upstash' : 'ioredis';

/**
 * Build a key prefix helper. Example:
 *   const k = redisFor('magic-link');
 *   await redis.set(k('abc'), '1');
 */
export function redisFor(prefix: string): (suffix: string) => string {
  return (suffix: string) => `podlife:${prefix}:${suffix}`;
}

export async function shutdownRedis(): Promise<void> {
  await redis.shutdown();
}
