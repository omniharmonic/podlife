/**
 * E2E coverage for the friendship workflow (T2).
 *
 * Verifies the full happy path through the API surface added by the
 * partnership/friendship distinction:
 *   - inviting as friendship vs. partnership
 *   - the relationship type flowing from the invite onto the partnership
 *     when accepted
 *   - toggling type after the fact via PATCH /:id/type
 *   - the listPartners projection carrying the type back to clients
 *   - validation on the type column
 *   - privacy: only members can mutate
 */
import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

describe('partners — friendship workflow', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authedSession(app: ReturnType<typeof newApp>): Promise<string> {
    const email = uniqueEmail('friend');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    return v.body.sessionToken;
  }

  it('invite + accept as friendship → both sides see relationshipType=friendship', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'friendship' },
    });
    expect(inv.status).toBe(200);

    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });
    expect(acc.status).toBe(200);
    const partnershipId = acc.body.partnershipId;

    const aList = await call(app, '/api/partners', { token: aTok });
    expect(aList.body.partners).toHaveLength(1);
    expect(aList.body.partners[0].partnershipId).toBe(partnershipId);
    expect(aList.body.partners[0].relationshipType).toBe('friendship');

    const bList = await call(app, '/api/partners', { token: bTok });
    expect(bList.body.partners[0].relationshipType).toBe('friendship');
  });

  it('omitted relationshipType on invite defaults to partnership', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner' },
    });
    await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });

    const list = await call(app, '/api/partners', { token: aTok });
    expect(list.body.partners[0].relationshipType).toBe('partnership');
  });

  it('PATCH /:id/type switches partnership ↔ friendship', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'partnership' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });
    const partnershipId = acc.body.partnershipId;

    // Switch to friendship.
    const r1 = await call(app, `/api/partners/${partnershipId}/type`, {
      method: 'PATCH',
      token: aTok,
      json: { relationshipType: 'friendship' },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.relationshipType).toBe('friendship');

    // Other partner sees the switch.
    const bList = await call(app, '/api/partners', { token: bTok });
    expect(bList.body.partners[0].relationshipType).toBe('friendship');

    // Switch back to partnership from the other side.
    const r2 = await call(app, `/api/partners/${partnershipId}/type`, {
      method: 'PATCH',
      token: bTok,
      json: { relationshipType: 'partnership' },
    });
    expect(r2.status).toBe(200);
    expect(r2.body.relationshipType).toBe('partnership');
  });

  it('rejects invalid relationshipType values (zod 400)', async () => {
    const app = newApp();
    const aTok = await authedSession(app);

    const r = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'situationship' },
    });
    expect(r.status).toBe(400);
  });

  it('non-member cannot change another partnership type (403)', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);
    const cTok = await authedSession(app);

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });

    const r = await call(app, `/api/partners/${acc.body.partnershipId}/type`, {
      method: 'PATCH',
      token: cTok,
      json: { relationshipType: 'friendship' },
    });
    expect(r.status).toBe(403);
  });

  it('preferences endpoint accepts a save in friendship mode (zeroed romantic fields)', async () => {
    // The UI zeros these out before submit; verify the API doesn't reject
    // legitimate friendship saves with 0 date nights / 0 overnights.
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'friendship' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });

    const upd = await call(app, `/api/partners/${acc.body.partnershipId}/preferences`, {
      method: 'PATCH',
      token: aTok,
      json: {
        needMinHours: 2,
        prefIdealHours: 4,
        needMinDateNights: 0,
        prefDateNights: 0,
        needMinOvernights: 0,
        prefOvernights: 0,
        prefDaytimeHangs: 2,
      },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.preferences.prefDateNights).toBe(0);
    expect(upd.body.preferences.prefOvernights).toBe(0);
    expect(upd.body.preferences.prefDaytimeHangs).toBe(2);
  });

  it('privacy: friend B cannot see partnerships from A\'s other partnerships', async () => {
    // A has both a friendship with B and a partnership with C.
    // B must not see anything about C, even though both are connected to A.
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);
    const cTok = await authedSession(app);

    const invB = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'friendship' },
    });
    await call(app, `/api/invites/${invB.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });

    const invC = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'partnership' },
    });
    await call(app, `/api/invites/${invC.body.token}/accept`, {
      method: 'POST',
      token: cTok,
    });

    const bList = await call(app, '/api/partners', { token: bTok });
    expect(bList.body.partners).toHaveLength(1);
    // B sees the friendship with A. B must NOT see any reference to C.
    const flat = JSON.stringify(bList.body);
    expect(flat).not.toContain(cTok.slice(0, 8)); // session token shouldn't leak either, but mostly: no C-shaped data
    // B's one visible partner is A (not C).
    expect(bList.body.partners[0].relationshipType).toBe('friendship');
  });

  it('the type column survives a preferences update (does not get overwritten)', async () => {
    // A regression guard: updateMyPreferences only writes preference fields,
    // never touches relationshipType. Without this guard, future refactors
    // that accidentally pass extra columns to the partnerships table on prefs
    // updates would silently flip types.
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: aTok,
      json: { kind: 'partner', relationshipType: 'friendship' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: bTok,
    });

    await call(app, `/api/partners/${acc.body.partnershipId}/preferences`, {
      method: 'PATCH',
      token: aTok,
      json: { needMinHours: 3, prefIdealHours: 6 },
    });

    const list = await call(app, '/api/partners', { token: aTok });
    expect(list.body.partners[0].relationshipType).toBe('friendship');
  });
});
