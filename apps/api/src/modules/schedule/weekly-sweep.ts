/**
 * Automated cycle scheduler (P5.2 weekly trigger).
 *
 * Invoked by the `weekly-sweep` job, which the cron route enqueues. For each
 * pod, it decides whether the pod is "due" for a scheduling cycle this period
 * (based on the pod's cadence + cycle day/time) and, if so, triggers one.
 *
 * Idempotency: a Redis marker per pod per period prevents double-triggering
 * when the cron fires more than once in a window (it's expected to run often,
 * e.g. hourly, and only act when a pod's scheduled moment has passed).
 *
 * Timezone: pods have no timezone of their own, so cycle_day_of_week and
 * cycle_time_of_day are evaluated in UTC. The cycle's *content* (what counts
 * as evening) is still per-person and timezone-aware in the optimizer.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { podMembers, pods } from '../../db/schema.js';
import { redis, redisFor } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { triggerCycle } from './cycle.manager.js';

const marker = redisFor('cycle-sweep');

/** Seconds in one cadence period — also the idempotency marker TTL. */
function periodSeconds(cadence: string): number {
  if (cadence === 'monthly') return 31 * 24 * 3600;
  if (cadence === 'biweekly') return 14 * 24 * 3600;
  return 7 * 24 * 3600;
}

/**
 * A stable key for the current cadence period, so one trigger fires per pod
 * per period regardless of how often the sweep runs.
 */
export function periodKey(cadence: string, now: Date): string {
  const y = now.getUTCFullYear();
  if (cadence === 'monthly') return `m:${y}-${now.getUTCMonth() + 1}`;
  // Week number (UTC, ISO-ish): days since epoch / 7.
  const week = Math.floor(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()) / 86400000 / 7);
  if (cadence === 'biweekly') return `b:${Math.floor(week / 2)}`;
  return `w:${week}`;
}

/**
 * Has the pod's scheduled cycle moment for the current week passed?
 * cycleDayOfWeek: 0=Sunday..6=Saturday; cycleTimeOfDay: "HH:MM[:SS]" UTC.
 */
export function isDue(
  now: Date,
  cycleDayOfWeek: number,
  cycleTimeOfDay: string,
): boolean {
  const dow = now.getUTCDay();
  if (dow < cycleDayOfWeek) return false;
  if (dow > cycleDayOfWeek) return true;
  // Same day — compare time of day in UTC.
  const [hh = 0, mm = 0] = cycleTimeOfDay.split(':').map((p) => parseInt(p, 10));
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMins >= hh * 60 + mm;
}

export interface SweepResult {
  scanned: number;
  dispatched: number;
}

export async function runWeeklyCycleSweep(now: Date = new Date()): Promise<SweepResult> {
  const allPods = await db.select().from(pods);
  let dispatched = 0;

  for (const pod of allPods) {
    if (!isDue(now, pod.cycleDayOfWeek, pod.cycleTimeOfDay)) continue;

    const key = marker(`${pod.id}:${periodKey(pod.schedulingCadence, now)}`);
    // INCR-as-claim: only the first sweep in this period sees count === 1.
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, periodSeconds(pod.schedulingCadence));
    } else {
      continue; // already triggered this period
    }

    // Pick a member to attribute the cycle to (prefer an admin).
    const members = await db
      .select({ personId: podMembers.personId, role: podMembers.role })
      .from(podMembers)
      .where(and(eq(podMembers.podId, pod.id), isNotNull(podMembers.joinedAt)));
    if (members.length === 0) continue;
    const trigger = members.find((m) => m.role === 'admin') ?? members[0]!;

    try {
      const { cycleId } = await triggerCycle({
        personId: trigger.personId,
        triggerType: 'automatic',
        podId: pod.id,
      });
      dispatched += 1;
      logger.info('weekly sweep triggered cycle', { podId: pod.id, cycleId });
    } catch (err) {
      // Release the marker so the next sweep can retry this period.
      await redis.del(key);
      logger.error('weekly sweep trigger failed', {
        podId: pod.id,
        err: (err as Error).message,
      });
    }
  }

  return { scanned: allPods.length, dispatched };
}
