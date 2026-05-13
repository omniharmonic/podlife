/**
 * E2E coverage for the per-partnership cadence confirmation flow (T6).
 *
 * The cadence column on `partnerships` is the single source of truth.
 * Changes require two-party confirmation: a proposer sets pendingCadence
 * via /cadence/propose, the *other* party accepts via /cadence/accept.
 * Either party can decline to clear a pending proposal.
 *
 * The interesting state-machine cases:
 *   - propose-current-while-pending acts as a withdrawal
 *   - re-proposing while pending overwrites
 *   - the proposer can't accept their own proposal (it would defeat the
 *     whole point of two-party confirmation)
 *   - declining clears pending but keeps current cadence
 *   - both sides see consistent state via /api/partners
 */
import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

describe('partners — cadence confirmation flow', () => {
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

  async function makePair(app: ReturnType<typeof newApp>): Promise<{
    a: { token: string; id: string };
    b: { token: string; id: string };
    partnershipId: string;
  }> {
    const a = await authed(app, 'cadA');
    const b = await authed(app, 'cadB');
    const inv = await call(app, '/api/partners/invite', {
      method: 'POST',
      token: a.token,
      json: {},
    });
    const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: b.token,
    });
    return { a, b, partnershipId: acc.body.partnershipId };
  }

  it('new partnership defaults to weekly cadence with no pending proposal', async () => {
    const app = newApp();
    const { a } = await makePair(app);
    const list = await call(app, '/api/partners', { token: a.token });
    expect(list.body.partners[0].cadence).toBe('weekly');
    expect(list.body.partners[0].pendingCadence).toBeNull();
    expect(list.body.partners[0].pendingCadenceBy).toBeNull();
  });

  it('propose sets pendingCadence visible to both sides; current unchanged', async () => {
    const app = newApp();
    const { a, b, partnershipId } = await makePair(app);

    const r = await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'biweekly' },
    });
    expect(r.status).toBe(200);
    expect(r.body.cadence).toBe('weekly');
    expect(r.body.pendingCadence).toBe('biweekly');
    expect(r.body.pendingCadenceBy).toBe(a.id);

    const aList = await call(app, '/api/partners', { token: a.token });
    expect(aList.body.partners[0].cadence).toBe('weekly');
    expect(aList.body.partners[0].pendingCadence).toBe('biweekly');
    expect(aList.body.partners[0].pendingCadenceBy).toBe(a.id);

    const bList = await call(app, '/api/partners', { token: b.token });
    expect(bList.body.partners[0].pendingCadence).toBe('biweekly');
    expect(bList.body.partners[0].pendingCadenceBy).toBe(a.id);
  });

  it('the proposer cannot accept their own proposal (400)', async () => {
    const app = newApp();
    const { a, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'biweekly' },
    });

    const r = await call(app, `/api/partners/${partnershipId}/cadence/accept`, {
      method: 'POST',
      token: a.token,
    });
    expect(r.status).toBe(400);
  });

  it('the other party accepts → cadence updates, pending cleared', async () => {
    const app = newApp();
    const { a, b, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'monthly' },
    });

    const r = await call(app, `/api/partners/${partnershipId}/cadence/accept`, {
      method: 'POST',
      token: b.token,
    });
    expect(r.status).toBe(200);
    expect(r.body.cadence).toBe('monthly');
    expect(r.body.pendingCadence).toBeNull();
    expect(r.body.pendingCadenceBy).toBeNull();

    const aList = await call(app, '/api/partners', { token: a.token });
    expect(aList.body.partners[0].cadence).toBe('monthly');
    expect(aList.body.partners[0].pendingCadence).toBeNull();
  });

  it('declining clears pending; current cadence unchanged', async () => {
    const app = newApp();
    const { a, b, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'biweekly' },
    });

    const r = await call(app, `/api/partners/${partnershipId}/cadence/decline`, {
      method: 'POST',
      token: b.token,
    });
    expect(r.status).toBe(200);
    expect(r.body.cadence).toBe('weekly');
    expect(r.body.pendingCadence).toBeNull();

    const list = await call(app, '/api/partners', { token: a.token });
    expect(list.body.partners[0].cadence).toBe('weekly');
    expect(list.body.partners[0].pendingCadence).toBeNull();
  });

  it('the proposer can also decline (withdraw) their own proposal', async () => {
    const app = newApp();
    const { a, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'biweekly' },
    });

    const r = await call(app, `/api/partners/${partnershipId}/cadence/decline`, {
      method: 'POST',
      token: a.token,
    });
    expect(r.status).toBe(200);
    expect(r.body.pendingCadence).toBeNull();
  });

  it('proposing the current cadence withdraws any pending proposal (no-op clear)', async () => {
    // UX affordance: clicking the "agreed" pill should withdraw a pending
    // change rather than no-op-ing entirely or 400-ing.
    const app = newApp();
    const { a, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'biweekly' },
    });

    const r = await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'weekly' }, // current
    });
    expect(r.status).toBe(200);
    expect(r.body.cadence).toBe('weekly');
    expect(r.body.pendingCadence).toBeNull();
    expect(r.body.pendingCadenceBy).toBeNull();
  });

  it('re-proposing while pending overwrites; last writer wins', async () => {
    const app = newApp();
    const { a, b, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'biweekly' },
    });
    const r = await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: b.token,
      json: { cadence: 'monthly' },
    });
    expect(r.status).toBe(200);
    expect(r.body.pendingCadence).toBe('monthly');
    expect(r.body.pendingCadenceBy).toBe(b.id);
  });

  it('accepting with no pending proposal returns 400', async () => {
    const app = newApp();
    const { a, partnershipId } = await makePair(app);
    const r = await call(app, `/api/partners/${partnershipId}/cadence/accept`, {
      method: 'POST',
      token: a.token,
    });
    expect(r.status).toBe(400);
  });

  it('declining with no pending proposal returns 400', async () => {
    const app = newApp();
    const { a, partnershipId } = await makePair(app);
    const r = await call(app, `/api/partners/${partnershipId}/cadence/decline`, {
      method: 'POST',
      token: a.token,
    });
    expect(r.status).toBe(400);
  });

  it('non-member cannot propose / accept / decline on a partnership they don\'t belong to', async () => {
    const app = newApp();
    const { partnershipId } = await makePair(app);
    const outsider = await authed(app, 'cadOut');

    const propose = await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: outsider.token,
      json: { cadence: 'biweekly' },
    });
    expect(propose.status).toBe(403);

    const accept = await call(app, `/api/partners/${partnershipId}/cadence/accept`, {
      method: 'POST',
      token: outsider.token,
    });
    expect(accept.status).toBe(403);

    const decline = await call(app, `/api/partners/${partnershipId}/cadence/decline`, {
      method: 'POST',
      token: outsider.token,
    });
    expect(decline.status).toBe(403);
  });

  it('rejects invalid cadence values (400 from zod)', async () => {
    const app = newApp();
    const { a, partnershipId } = await makePair(app);
    const r = await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'fortnightly' },
    });
    expect(r.status).toBe(400);
  });

  it('a preferences update does not disturb cadence state (regression guard)', async () => {
    const app = newApp();
    const { a, b, partnershipId } = await makePair(app);

    await call(app, `/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      token: a.token,
      json: { cadence: 'monthly' },
    });
    await call(app, `/api/partners/${partnershipId}/cadence/accept`, {
      method: 'POST',
      token: b.token,
    });

    await call(app, `/api/partners/${partnershipId}/preferences`, {
      method: 'PATCH',
      token: a.token,
      json: { needMinHours: 3, prefIdealHours: 6 },
    });

    const list = await call(app, '/api/partners', { token: a.token });
    expect(list.body.partners[0].cadence).toBe('monthly');
    expect(list.body.partners[0].pendingCadence).toBeNull();
  });
});
