/**
 * Schedule authorization regression tests.
 *
 * Covers two cross-tenant holes that were live-exploitable:
 *   H1 — POST /schedule/reshuffle let any authenticated user reshuffle
 *        (cancel) a block they don't participate in, by id.
 *   H2 — POST /schedule/run let a non-member trigger a cycle for an
 *        arbitrary pod.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

async function authed(
  app: ReturnType<typeof newApp>,
  prefix: string,
  bag: string[],
): Promise<{ token: string; id: string }> {
  const email = uniqueEmail(prefix);
  bag.push(email);
  const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
  const v = await call(app, '/auth/verify', {
    method: 'POST',
    json: { email, token: r.body.devToken },
  });
  return { token: v.body.sessionToken, id: v.body.person.id };
}

describe('schedule authorization', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('H2: a non-member cannot trigger a cycle for someone else’s pod', async () => {
    const app = newApp();
    const a = await authed(app, 'azh2', created);
    const outsider = await authed(app, 'ozh2', created);

    const pod = await call(app, '/api/pods', {
      method: 'POST',
      token: a.token,
      json: { name: 'Private', emoji: '🔒' },
    });
    const podId = pod.body.pod?.id ?? pod.body.id;
    expect(podId).toBeTruthy();

    const res = await call(app, '/api/schedule/run', {
      method: 'POST',
      token: outsider.token,
      json: { podId },
    });
    expect(res.status).toBe(404); // not found / not a member — no info leak

    // The owner CAN trigger it.
    const ok = await call(app, '/api/schedule/run', {
      method: 'POST',
      token: a.token,
      json: { podId },
    });
    expect(ok.status).toBe(200);
  });

  it('H1: a non-participant cannot reshuffle a block', async () => {
    const app = newApp();
    const a = await authed(app, 'azh1', created);
    const b = await authed(app, 'bzh1', created);
    const outsider = await authed(app, 'ozh1', created);

    // A↔B partnership with availability so a cycle yields a block.
    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: a.token,
      json: { kind: 'partner' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: b.token,
    });
    const partnershipId = acc.body.partnershipId;
    for (const t of [a.token, b.token]) {
      await call(app, `/api/partners/${partnershipId}/preferences`, {
        method: 'PATCH',
        token: t,
        json: { needMinHours: 2, prefIdealHours: 4, prefDateNights: 1 },
      });
    }
    const start = new Date(Date.now() + 24 * 60 * 60_000);
    start.setUTCHours(18, 0, 0, 0);
    const windows = [
      { start: start.toISOString(), end: new Date(start.getTime() + 6 * 3600_000).toISOString() },
    ];
    for (const t of [a.token, b.token]) {
      await call(app, '/api/me/availability/manual', {
        method: 'POST',
        token: t,
        json: { windows },
      });
    }
    const run = await call(app, '/api/schedule/run', {
      method: 'POST',
      token: a.token,
      json: {
        horizonStart: new Date(start.getTime() - 3600_000).toISOString(),
        horizonEnd: new Date(start.getTime() + 7 * 3600_000).toISOString(),
      },
    });
    await call(app, `/api/schedule/_test/run-now/${run.body.cycleId}`, {
      method: 'POST',
      token: a.token,
    });
    const props = await call(app, '/api/schedule/proposals', { token: a.token });
    const block = props.body.proposals?.[0];
    expect(block).toBeTruthy();

    // Outsider attempts to reshuffle A&B's block → denied, nothing changes.
    const hijack = await call(app, '/api/schedule/reshuffle', {
      method: 'POST',
      token: outsider.token,
      json: { blockId: block.id, reason: 'hijack' },
    });
    expect(hijack.status).toBe(404);

    // The block is still proposed (not reshuffled away).
    const after = await call(app, '/api/schedule/proposals', { token: a.token });
    const stillThere = after.body.proposals?.some((p: { id: string }) => p.id === block.id);
    expect(stillThere).toBe(true);

    // A participant CAN reshuffle it.
    const ok = await call(app, '/api/schedule/reshuffle', {
      method: 'POST',
      token: b.token,
      json: { blockId: block.id, reason: 'conflict' },
    });
    expect(ok.status).toBe(200);
  });
});
