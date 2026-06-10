/**
 * Automated weekly cycle sweep (P5.2).
 *
 * Verifies the due-ness logic and that a sweep triggers a cycle for a pod
 * exactly once per period (idempotent), attributing it to a member.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import { db } from '../src/db/index.ts';
import { pods, schedulingCycles } from '../src/db/schema.ts';
import { runWithServiceContext } from '../src/db/rls.ts';
import { isDue, periodKey, runWeeklyCycleSweep } from '../src/modules/schedule/weekly-sweep.ts';

describe('weekly cycle sweep', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('isDue respects day-of-week and time-of-day (UTC)', () => {
    // Wednesday 2026-06-10 21:00 UTC.
    const now = new Date('2026-06-10T21:00:00Z');
    expect(now.getUTCDay()).toBe(3); // Wed
    expect(isDue(now, 3, '20:00')).toBe(true); // due day, past time
    expect(isDue(now, 3, '22:00')).toBe(false); // due day, before time
    expect(isDue(now, 2, '20:00')).toBe(true); // earlier weekday → due
    expect(isDue(now, 5, '08:00')).toBe(false); // later weekday → not yet
  });

  it('periodKey is stable within a cadence period and changes across it', () => {
    const a = new Date('2026-06-08T00:00:00Z'); // Mon
    const b = new Date('2026-06-10T23:00:00Z'); // Wed same week
    const c = new Date('2026-06-18T00:00:00Z'); // next week
    expect(periodKey('weekly', a)).toBe(periodKey('weekly', b));
    expect(periodKey('weekly', a)).not.toBe(periodKey('weekly', c));
    expect(periodKey('monthly', a)).toBe('m:2026-6');
  });

  it('triggers a due pod exactly once per period', async () => {
    const app = newApp();
    const email = uniqueEmail('sweep');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const token = v.body.sessionToken as string;

    const pod = await call(app, '/api/pods', {
      method: 'POST',
      token,
      json: { name: 'Sweepable', emoji: '🌀' },
    });
    const podId = pod.body.pod?.id ?? pod.body.id;

    // Force the pod due "now" by setting its cycle moment to the past.
    const now = new Date();
    await db
      .update(pods)
      .set({ cycleDayOfWeek: now.getUTCDay(), cycleTimeOfDay: '00:00', schedulingCadence: 'weekly' })
      .where(eq(pods.id, podId));

    async function cyclesForPod(): Promise<number> {
      return runWithServiceContext(async () => {
        const rows = await db
          .select()
          .from(schedulingCycles)
          .where(and(eq(schedulingCycles.triggerType, 'automatic')));
        return rows.filter((c) => c.personIds.includes(v.body.person.id)).length;
      });
    }

    const before = await cyclesForPod();
    const first = await runWithServiceContext(() => runWeeklyCycleSweep(now));
    expect(first.dispatched).toBeGreaterThanOrEqual(1);
    const afterFirst = await cyclesForPod();
    expect(afterFirst).toBe(before + 1);

    // Second sweep in the same period must NOT trigger again.
    const second = await runWithServiceContext(() => runWeeklyCycleSweep(now));
    const afterSecond = await cyclesForPod();
    expect(afterSecond).toBe(afterFirst);
    void second;
  });
});
