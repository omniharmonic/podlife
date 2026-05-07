/**
 * Free/busy aggregator (per arch § 6.3).
 *
 * For a given person and time range:
 *  1. Collect busy windows from all connected calendar providers.
 *  2. Add `blocked_windows` derived from the person's recurring blocked windows.
 *  3. Merge overlapping/adjacent windows.
 *  4. Invert into a set of free windows over [rangeStart, rangeEnd].
 *  5. Optionally fall back to manual availability if no provider.
 *
 * Result is cached in Redis for AVAIL_CACHE_TTL_SECONDS (key includes range).
 * The cache is also explicitly busted on calendar connect/disconnect and
 * manual availability writes.
 */
import { eq } from 'drizzle-orm';
import type { BlockedWindow } from '@pod-life/shared';
import { db } from '../../db/index.js';
import { calendarConnections, persons } from '../../db/schema.js';
import { redis, redisFor } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { googleProvider } from './google.provider.js';
import { listManualWindows } from './manual.provider.js';

export interface FreeWindow {
  start: Date;
  end: Date;
}

/** Merge overlapping & adjacent windows. Pure function — easy to unit-test. */
export function mergeOverlappingWindows(windows: FreeWindow[]): FreeWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: FreeWindow[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i]!;
    if (w.start.getTime() <= cur.end.getTime()) {
      // overlap or touching — extend
      if (w.end.getTime() > cur.end.getTime()) cur.end = w.end;
    } else {
      merged.push(cur);
      cur = { ...w };
    }
  }
  merged.push(cur);
  return merged;
}

/** Invert busy windows into free windows over the requested range. */
export function invertToFreeWindows(
  busy: FreeWindow[],
  rangeStart: Date,
  rangeEnd: Date,
): FreeWindow[] {
  const merged = mergeOverlappingWindows(busy);
  const free: FreeWindow[] = [];
  let cursor = rangeStart;
  for (const b of merged) {
    if (b.end <= cursor) continue;
    if (b.start >= rangeEnd) break;
    if (b.start > cursor) {
      free.push({ start: cursor, end: b.start < rangeEnd ? b.start : rangeEnd });
    }
    cursor = b.end > cursor ? b.end : cursor;
    if (cursor >= rangeEnd) {
      cursor = rangeEnd;
      break;
    }
  }
  if (cursor < rangeEnd) {
    free.push({ start: cursor, end: rangeEnd });
  }
  return free.filter((w) => w.end.getTime() > w.start.getTime());
}

/** Expand recurring blocked windows into concrete date ranges within [start, end]. */
export function expandBlockedWindows(
  blocked: BlockedWindow[],
  start: Date,
  end: Date,
  timezone: string,
): FreeWindow[] {
  void timezone; // future: use Intl/Temporal in target tz; for now treat as UTC.
  if (!blocked.length) return [];
  const out: FreeWindow[] = [];
  for (
    let day = new Date(start.getTime());
    day < end;
    day = new Date(day.getTime() + 24 * 60 * 60_000)
  ) {
    const dow = day.getUTCDay();
    for (const w of blocked) {
      if (w.dayOfWeek !== dow) continue;
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const ws = new Date(day);
      ws.setUTCHours(sh ?? 0, sm ?? 0, 0, 0);
      const we = new Date(day);
      we.setUTCHours(eh ?? 0, em ?? 0, 0, 0);
      if (we <= ws) continue;
      out.push({ start: ws, end: we });
    }
  }
  return out;
}

const cacheKey = redisFor('avail');
/**
 * Free/busy cache TTL. Short enough that stale data drops quickly when
 * source-of-truth changes out-of-band (e.g., direct DB writes, or a fix
 * we haven't wired explicit invalidation for yet); long enough that
 * cycles that touch the same person multiple times in a row reuse the
 * Google response (one cycle calls ~3-5 times across persons + reshuffles).
 */
const AVAIL_CACHE_TTL_SECONDS = 5 * 60;

export async function getPersonFreeWindows(
  personId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<FreeWindow[]> {
  const key = cacheKey(`${personId}:${rangeStart.toISOString()}:${rangeEnd.toISOString()}`);
  const cached = await redis.get(key);
  if (cached) {
    return (JSON.parse(cached) as Array<{ start: string; end: string }>).map((w) => ({
      start: new Date(w.start),
      end: new Date(w.end),
    }));
  }

  const personRows = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  const person = personRows[0];
  if (!person) return [];

  const connections = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.personId, personId));

  const busy: FreeWindow[] = [];
  let providerSucceeded = false;

  for (const conn of connections) {
    if (conn.provider !== 'google') continue; // only google in v1
    try {
      const fb = await googleProvider.getFreeBusy(conn, rangeStart, rangeEnd);
      busy.push(...fb);
      providerSucceeded = true;
    } catch (err) {
      logger.warn('calendar provider error', {
        provider: conn.provider,
        err: (err as Error).message,
      });
    }
  }

  // Fallback to manual availability when no provider.
  if (!providerSucceeded) {
    const manual = await listManualWindows(personId, rangeStart, rangeEnd);
    if (manual.length > 0) {
      // Manual rows store FREE windows, not busy. Cache and return them
      // directly (clipped to the range), bypassing inversion.
      const free = mergeOverlappingWindows(
        manual.map((w) => ({
          start: w.start < rangeStart ? rangeStart : w.start,
          end: w.end > rangeEnd ? rangeEnd : w.end,
        })),
      );
      await redis.set(
        key,
        JSON.stringify(free.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() }))),
        AVAIL_CACHE_TTL_SECONDS,
      );
      return free;
    }
    // No data at all → entire range is free.
    return [{ start: rangeStart, end: rangeEnd }];
  }

  // Add blocked windows from person settings (recurring, expanded over range).
  const blocked = (person.blockedWindows ?? []) as BlockedWindow[];
  busy.push(...expandBlockedWindows(blocked, rangeStart, rangeEnd, person.timezone));

  const free = invertToFreeWindows(busy, rangeStart, rangeEnd);
  await redis.set(
    key,
    JSON.stringify(free.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() }))),
    AVAIL_CACHE_TTL_SECONDS,
  );
  return free;
}

export async function invalidatePersonAvailabilityCache(personId: string): Promise<void> {
  // delByPattern uses SCAN under the hood on both ioredis and Upstash backends.
  await redis.delByPattern(cacheKey(`${personId}:*`));
}
