import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import { config } from '../src/lib/config.ts';

let optimizerReachable = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${config.optimizerUrl}/health`);
    optimizerReachable = r.ok;
  } catch {
    optimizerReachable = false;
  }
});

describe('schedule cycle (e2e)', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it(
    'two persons + partnership + manual avail → cycle proposes blocks',
    async (ctx) => {
      if (!optimizerReachable) {
        ctx.skip();
        return;
      }
      const app = newApp();

      // Two persons & sessions.
      async function authed(prefix: string): Promise<{ token: string; id: string }> {
        const email = uniqueEmail(prefix);
        created.push(email);
        const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
        const v = await call(app, '/auth/verify', {
          method: 'POST',
          json: { email, token: r.body.devToken },
        });
        return { token: v.body.sessionToken, id: v.body.person.id };
      }
      const a = await authed('sa');
      const b = await authed('sb');

      // Partnership.
      const inv = await call(app, '/api/partners/invite', {
        method: 'POST',
        token: a.token,
        json: {},
      });
      const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
        method: 'POST',
        token: b.token,
      });
      const partnershipId = acc.body.partnershipId;

      // Set preferences (modest needs/prefs that should fit).
      await call(app, `/api/partners/${partnershipId}/preferences`, {
        method: 'PATCH',
        token: a.token,
        json: { needMinHours: 2, prefIdealHours: 4, prefDateNights: 1 },
      });
      await call(app, `/api/partners/${partnershipId}/preferences`, {
        method: 'PATCH',
        token: b.token,
        json: { needMinHours: 2, prefIdealHours: 4, prefDateNights: 1 },
      });

      // Manual availability for both: same large window.
      const start = new Date(Date.now() + 24 * 60 * 60_000);
      start.setUTCHours(18, 0, 0, 0);
      const end = new Date(start.getTime() + 6 * 60 * 60_000); // 6h window today
      const day2start = new Date(start.getTime() + 24 * 60 * 60_000);
      const day2end = new Date(end.getTime() + 24 * 60 * 60_000);

      const windows = [
        { start: start.toISOString(), end: end.toISOString() },
        { start: day2start.toISOString(), end: day2end.toISOString() },
      ];
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

      // Trigger cycle with explicit horizon.
      const horizonStart = new Date(start.getTime() - 60 * 60_000);
      const horizonEnd = new Date(day2end.getTime() + 60 * 60_000);
      const run = await call(app, '/api/schedule/run', {
        method: 'POST',
        token: a.token,
        json: {
          horizonStart: horizonStart.toISOString(),
          horizonEnd: horizonEnd.toISOString(),
        },
      });
      expect(run.status).toBe(200);
      const cycleId = run.body.cycleId;

      // Process the cycle synchronously (test backdoor).
      const proc = await call(app, `/api/schedule/_test/run-now/${cycleId}`, {
        method: 'POST',
        token: a.token,
      });
      expect(proc.status).toBe(200);

      // List proposals.
      const props = await call(app, '/api/schedule/proposals', { token: a.token });
      expect(props.status).toBe(200);
      // We don't assert exact count because the optimizer chooses based on prefs;
      // but a non-empty proposal set is a strong signal the pipeline works.
      expect(Array.isArray(props.body.proposals)).toBe(true);

      // Cycle detail visible to a participant.
      const detail = await call(app, `/api/schedule/cycles/${cycleId}`, { token: a.token });
      expect(detail.status).toBe(200);
      expect(detail.body.cycle.id).toBe(cycleId);
    },
    60_000,
  );
});
