/**
 * E2E coverage for the accept-flow state machine (T4a + T4b).
 *
 * The respond handler must transition blocks through `accepted` (not skip it)
 * when the last participant accepts. The block only advances to `locked`
 * when every calendar PATCH succeeds. With no calendars connected — the
 * setup most tests run in — `confirmEventsForBlock` is a trivial success
 * (nothing to confirm), so blocks end up `locked` inline and disappear from
 * the proposals list. The `calendarWarning` flag should be false in that
 * case.
 *
 * The companion auto-lock job test verifies that a block stuck in `accepted`
 * (the failure-spillover case) gets swept up and moved to `locked` on the
 * next cron run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { timeBlocks, timeBlockParticipants } from '../src/db/schema.ts';
import { runAutoLock } from '../src/jobs/auto-lock.ts';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

describe('accept flow — state machine', () => {
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

  /**
   * Stand up a partnership + manual availability + a triggered+processed
   * cycle, returning the proposals that landed for each side. Several tests
   * share this scaffolding so we extract it once.
   */
  async function makeCycleWithProposals(app: ReturnType<typeof newApp>): Promise<{
    a: { token: string; id: string };
    b: { token: string; id: string };
    cycleId: string;
  }> {
    const a = await authed(app, 'accA');
    const b = await authed(app, 'accB');

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

    const start = new Date(Date.now() + 24 * 60 * 60_000);
    start.setUTCHours(18, 0, 0, 0);
    const end = new Date(start.getTime() + 6 * 60 * 60_000);
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

    const run = await call(app, '/api/schedule/run', {
      method: 'POST',
      token: a.token,
      json: {
        horizonStart: new Date(start.getTime() - 60 * 60_000).toISOString(),
        horizonEnd: new Date(day2end.getTime() + 60 * 60_000).toISOString(),
      },
    });
    expect(run.status).toBe(200);
    const cycleId = run.body.cycleId;

    const proc = await call(app, `/api/schedule/_test/run-now/${cycleId}`, {
      method: 'POST',
      token: a.token,
    });
    expect(proc.status).toBe(200);

    return { a, b, cycleId };
  }

  it(
    'one participant accepts → block stays `proposed`, response recorded',
    async () => {
      const app = newApp();
      const { a, b } = await makeCycleWithProposals(app);

      const aProps = await call(app, '/api/schedule/proposals', { token: a.token });
      expect(aProps.body.proposals.length).toBeGreaterThan(0);
      const blockId = aProps.body.proposals[0].id;

      const r = await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: a.token,
        json: { response: 'accepted' },
      });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);

      // Block status still 'proposed' because B hasn't responded.
      const row = await db
        .select()
        .from(timeBlocks)
        .where(eq(timeBlocks.id, blockId))
        .limit(1);
      expect(row[0]?.status).toBe('proposed');

      // A's response recorded.
      const partRow = await db
        .select()
        .from(timeBlockParticipants)
        .where(
          and(
            eq(timeBlockParticipants.timeBlockId, blockId),
            eq(timeBlockParticipants.personId, a.id),
          ),
        )
        .limit(1);
      expect(partRow[0]?.response).toBe('accepted');

      // The block stays in the proposals list for both sides (A has accepted,
      // B hasn't responded — the block is still "in flight").
      const aProps2 = await call(app, '/api/schedule/proposals', { token: a.token });
      const aBlock = aProps2.body.proposals.find((p: { id: string }) => p.id === blockId);
      expect(aBlock?.myResponse).toBe('accepted');

      void b;
    },
    60_000,
  );

  it(
    'all participants accept (no calendars) → block transitions to `locked`; calendarWarning=false',
    async () => {
      const app = newApp();
      const { a, b } = await makeCycleWithProposals(app);

      const props = await call(app, '/api/schedule/proposals', { token: a.token });
      const blockId = props.body.proposals[0].id;

      await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: a.token,
        json: { response: 'accepted' },
      });
      const r2 = await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: b.token,
        json: { response: 'accepted' },
      });
      expect(r2.status).toBe(200);
      // No connected calendars → confirmEventsForBlock returns true trivially.
      expect(r2.body.calendarWarning).toBe(false);

      const row = await db
        .select()
        .from(timeBlocks)
        .where(eq(timeBlocks.id, blockId))
        .limit(1);
      expect(row[0]?.status).toBe('locked');

      // Locked blocks vanish from the /proposals list.
      const aProps2 = await call(app, '/api/schedule/proposals', { token: a.token });
      expect(
        aProps2.body.proposals.find((p: { id: string }) => p.id === blockId),
      ).toBeUndefined();
    },
    60_000,
  );

  it(
    'auto-lock sweeps blocks stuck in `accepted` and moves them to `locked`',
    async () => {
      // Simulate the spillover case: inline confirm partially failed, leaving
      // the block in 'accepted'. The cron must find it and resolve it.
      const app = newApp();
      const { a, b } = await makeCycleWithProposals(app);

      const props = await call(app, '/api/schedule/proposals', { token: a.token });
      const blockId = props.body.proposals[0].id;

      // Accept on both sides — which normally flows straight to 'locked'
      // because no calendars are connected.
      await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: a.token,
        json: { response: 'accepted' },
      });
      await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: b.token,
        json: { response: 'accepted' },
      });

      // Manually rewind to 'accepted' to mimic the cron-spillover scenario.
      await db
        .update(timeBlocks)
        .set({ status: 'accepted' })
        .where(eq(timeBlocks.id, blockId));

      await runAutoLock();

      const row = await db
        .select()
        .from(timeBlocks)
        .where(eq(timeBlocks.id, blockId))
        .limit(1);
      expect(row[0]?.status).toBe('locked');
    },
    60_000,
  );

  it(
    'declining a block flips its status to `declined`',
    async () => {
      const app = newApp();
      const { a, b } = await makeCycleWithProposals(app);

      const props = await call(app, '/api/schedule/proposals', { token: a.token });
      const blockId = props.body.proposals[0].id;

      const r = await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: a.token,
        json: { response: 'declined' },
      });
      expect(r.status).toBe(200);

      const row = await db
        .select()
        .from(timeBlocks)
        .where(eq(timeBlocks.id, blockId))
        .limit(1);
      expect(row[0]?.status).toBe('declined');

      // Declined blocks are also excluded from /proposals.
      const aProps2 = await call(app, '/api/schedule/proposals', { token: a.token });
      expect(
        aProps2.body.proposals.find((p: { id: string }) => p.id === blockId),
      ).toBeUndefined();
      void b;
    },
    60_000,
  );

  it(
    'response is idempotent — re-accepting an already-accepted block is a no-op for state',
    async () => {
      // Regression guard for the "let me keep clicking accept" UX bug: the
      // optimistic update prevents a second click in practice, but if it does
      // fire, the server must not double-process state or leak side effects.
      const app = newApp();
      const { a, b } = await makeCycleWithProposals(app);

      const props = await call(app, '/api/schedule/proposals', { token: a.token });
      const blockId = props.body.proposals[0].id;

      const first = await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: a.token,
        json: { response: 'accepted' },
      });
      expect(first.status).toBe(200);

      const second = await call(app, `/api/schedule/proposals/${blockId}/respond`, {
        method: 'POST',
        token: a.token,
        json: { response: 'accepted' },
      });
      expect(second.status).toBe(200);

      // Still exactly one participant row for A on this block.
      const partRows = await db
        .select()
        .from(timeBlockParticipants)
        .where(
          and(
            eq(timeBlockParticipants.timeBlockId, blockId),
            eq(timeBlockParticipants.personId, a.id),
          ),
        );
      expect(partRows).toHaveLength(1);
      expect(partRows[0]?.response).toBe('accepted');
      void b;
    },
    60_000,
  );

});
