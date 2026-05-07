/**
 * Simple Redis-backed fixed-window rate limiter: 100 requests per minute per IP.
 */
import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { redis, redisFor } from '../lib/redis.js';

const DEFAULT_LIMIT = 100;
const WINDOW_SECONDS = 60;
const k = redisFor('rl');

export function rateLimit(limit = DEFAULT_LIMIT): MiddlewareHandler {
  return async (c, next) => {
    // Skip in test mode — tests do many calls per second.
    if (config.isTest) {
      await next();
      return;
    }
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = k(`${ip}:${window}`);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS + 5);
    }
    if (count > limit) {
      throw new RateLimitError();
    }
    await next();
  };
}
