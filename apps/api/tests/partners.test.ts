import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

describe('partners', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authedSession(app: ReturnType<typeof newApp>): Promise<string> {
    const email = uniqueEmail('partner');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    return v.body.sessionToken;
  }

  it('invites and accepts a partner; both sides see partnership', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/partners/invite', {
      method: 'POST',
      token: aTok,
      json: { displayHint: 'My partner' },
    });
    expect(inv.status).toBe(200);
    expect(inv.body.token).toBeDefined();

    const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: bTok,
    });
    expect(acc.status).toBe(200);
    expect(acc.body.partnershipId).toBeDefined();

    const aList = await call(app, '/api/partners', { token: aTok });
    expect(aList.status).toBe(200);
    expect(aList.body.partners).toHaveLength(1);
    const bList = await call(app, '/api/partners', { token: bTok });
    expect(bList.body.partners).toHaveLength(1);
  });

  it('updates partnership preferences', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);

    const inv = await call(app, '/api/partners/invite', {
      method: 'POST',
      token: aTok,
      json: {},
    });
    const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: bTok,
    });
    const partnershipId = acc.body.partnershipId;

    const upd = await call(app, `/api/partners/${partnershipId}/preferences`, {
      method: 'PATCH',
      token: aTok,
      json: { needMinHours: 5, prefIdealHours: 10, prefDateNights: 1 },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.preferences.needMinHours).toBe(5);
    expect(upd.body.preferences.prefIdealHours).toBe(10);
  });

  it('cross-pod privacy: a third person cannot see the partnership', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const bTok = await authedSession(app);
    const cTok = await authedSession(app); // unrelated

    const inv = await call(app, '/api/partners/invite', { method: 'POST', token: aTok, json: {} });
    await call(app, `/api/partners/accept/${inv.body.token}`, { method: 'POST', token: bTok });

    const cList = await call(app, '/api/partners', { token: cTok });
    expect(cList.status).toBe(200);
    expect(cList.body.partners).toHaveLength(0);
  });

  it('rejects own invite acceptance', async () => {
    const app = newApp();
    const aTok = await authedSession(app);
    const inv = await call(app, '/api/partners/invite', { method: 'POST', token: aTok, json: {} });
    const r = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: aTok,
    });
    expect(r.status).toBe(400);
  });
});

describe('pods', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authed(app: ReturnType<typeof newApp>): Promise<string> {
    const email = uniqueEmail('pod');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    return v.body.sessionToken;
  }

  it('creates pod, invites another member, joins', async () => {
    const app = newApp();
    const aTok = await authed(app);
    const bTok = await authed(app);

    const c = await call(app, '/api/pods', {
      method: 'POST',
      token: aTok,
      json: { name: 'Cottage' },
    });
    expect(c.status).toBe(200);
    const podId = c.body.pod.id;

    const inv = await call(app, `/api/pods/${podId}/invite`, {
      method: 'POST',
      token: aTok,
      json: { role: 'member' },
    });
    expect(inv.status).toBe(200);

    const join = await call(app, `/api/pods/join/${inv.body.token}`, {
      method: 'POST',
      token: bTok,
    });
    expect(join.status).toBe(200);

    const detail = await call(app, `/api/pods/${podId}`, { token: bTok });
    expect(detail.status).toBe(200);
    expect(detail.body.members).toHaveLength(2);
  });

  it('non-members get 403 on pod detail', async () => {
    const app = newApp();
    const aTok = await authed(app);
    const cTok = await authed(app); // outsider

    const c = await call(app, '/api/pods', {
      method: 'POST',
      token: aTok,
      json: { name: 'Secret Pod' },
    });
    const podId = c.body.pod.id;

    const r = await call(app, `/api/pods/${podId}`, { token: cTok });
    expect(r.status).toBe(403);
  });

  it('non-admin members cannot edit pod', async () => {
    const app = newApp();
    const aTok = await authed(app);
    const bTok = await authed(app);

    const c = await call(app, '/api/pods', { method: 'POST', token: aTok, json: { name: 'P1' } });
    const podId = c.body.pod.id;
    const inv = await call(app, `/api/pods/${podId}/invite`, {
      method: 'POST',
      token: aTok,
      json: { role: 'member' },
    });
    await call(app, `/api/pods/join/${inv.body.token}`, { method: 'POST', token: bTok });

    const r = await call(app, `/api/pods/${podId}`, {
      method: 'PATCH',
      token: bTok,
      json: { name: 'Hijacked' },
    });
    expect(r.status).toBe(403);
  });
});
