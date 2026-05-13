/**
 * Regression coverage for the broken "Find time" notification path.
 *
 * Symptom: clicking the in-app "New schedule proposed" notification from
 * the home page Updates section didn't navigate anywhere. Two underlying
 * bugs:
 *   1. The actionUrl was being written as `${frontendUrl}/schedule/cycles/<id>`
 *      — a fully-qualified URL, which React Router's <Link to> treats as
 *      external and forces a full page reload through.
 *   2. The path /schedule/cycles/:id was never registered as a route.
 *      The catch-all redirects unknown paths back to /home, so the click
 *      "did nothing" from the user's perspective.
 *
 * Fix: callers now store relative paths in actionUrl, and the post-cycle
 * notification points to /schedule/review (the actual review page).
 * notification.service.ts builds an absolute URL on-demand for Telegram.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { notifications } from '../src/db/schema.ts';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

describe('notification action URLs — relative path + valid route', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authed(
    app: ReturnType<typeof newApp>,
    prefix: string,
  ): Promise<{ token: string; id: string }> {
    const email = uniqueEmail(prefix);
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    return { token: v.body.sessionToken, id: v.body.person.id };
  }

  it(
    '"New schedule proposed" notification stores /schedule/review (relative)',
    async () => {
      const app = newApp();
      const a = await authed(app, 'urlA');
      const b = await authed(app, 'urlB');

      // Set up a partnership + availability so the cycle has something to propose.
      const inv = await call(app, '/api/invites', {
        method: 'POST',
        token: a.token,
        json: { kind: 'partner' },
      });
      const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
        method: 'POST',
        token: b.token,
      });
      await call(app, `/api/partners/${acc.body.partnershipId}/preferences`, {
        method: 'PATCH',
        token: a.token,
        json: { needMinHours: 2, prefIdealHours: 4, prefDateNights: 1 },
      });
      await call(app, `/api/partners/${acc.body.partnershipId}/preferences`, {
        method: 'PATCH',
        token: b.token,
        json: { needMinHours: 2, prefIdealHours: 4, prefDateNights: 1 },
      });

      const start = new Date(Date.now() + 24 * 60 * 60_000);
      start.setUTCHours(18, 0, 0, 0);
      const end = new Date(start.getTime() + 6 * 60 * 60_000);
      const windows = [{ start: start.toISOString(), end: end.toISOString() }];
      await call(app, '/api/me/availability/manual', {
        method: 'POST',
        token: a.token,
        json: { windows },
      });
      await call(app, '/api/me/availability/manual', {
        method: 'POST',
        token: b.token,
        json: { windows },
      });

      const run = await call(app, '/api/schedule/run', {
        method: 'POST',
        token: a.token,
        json: {
          horizonStart: new Date(start.getTime() - 60 * 60_000).toISOString(),
          horizonEnd: new Date(end.getTime() + 60 * 60_000).toISOString(),
        },
      });
      expect(run.status).toBe(200);
      await call(app, `/api/schedule/_test/run-now/${run.body.cycleId}`, {
        method: 'POST',
        token: a.token,
      });

      // Pull A's most recent notification — the cycle just dispatched one.
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.personId, a.id))
        .orderBy(desc(notifications.createdAt))
        .limit(5);

      const scheduleNotif = rows.find((n) => n.title === 'New schedule proposed');
      expect(scheduleNotif).toBeDefined();
      // Relative path that the SPA's React Router can navigate to.
      expect(scheduleNotif?.actionUrl).toBe('/schedule/review');
      // Sanity: not a fully-qualified URL (the original bug).
      expect(scheduleNotif?.actionUrl).not.toMatch(/^https?:\/\//);
      // Sanity: not the broken legacy path.
      expect(scheduleNotif?.actionUrl).not.toMatch(/\/schedule\/cycles\//);
    },
    60_000,
  );

  it(
    'partner-accepted notification stores /partners (relative)',
    async () => {
      const app = newApp();
      const a = await authed(app, 'urlPA');
      const b = await authed(app, 'urlPB');

      const inv = await call(app, '/api/invites', {
        method: 'POST',
        token: a.token,
        json: { kind: 'partner' },
      });
      await call(app, `/api/invites/${inv.body.token}/accept`, {
        method: 'POST',
        token: b.token,
      });

      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.personId, a.id))
        .orderBy(desc(notifications.createdAt))
        .limit(5);
      const acceptedNotif = rows.find((n) => n.title === 'Partner invite accepted');
      expect(acceptedNotif).toBeDefined();
      expect(acceptedNotif?.actionUrl).toBe('/partners');
    },
    60_000,
  );
});
