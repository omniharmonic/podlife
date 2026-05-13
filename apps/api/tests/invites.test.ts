/**
 * Unified invite flow — covers what the kind-specific partner/pod tests don't:
 *
 *   - Public preview is reachable without auth and leaks only the minimum
 *     (inviter name + kind + pod name).
 *   - Cold signup-on-accept: a brand-new email (no Person yet) flows through
 *     request-code → verify → accept and ends up partnered / in-pod.
 *   - Revoke / list-mine / horizontal pod authorization edge cases.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { call, createTestPerson, deletePerson, newApp, uniqueEmail } from './utils.ts';
import { db } from '../src/db/index.ts';
import { persons } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

describe('invites — preview', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authed(): Promise<{ sessionToken: string; personId: string; email: string }> {
    const email = uniqueEmail('inv');
    created.push(email);
    const s = await createTestPerson(email);
    return { ...s, email };
  }

  it('preview is reachable WITHOUT a bearer token', async () => {
    const app = newApp();
    const a = await authed();
    await db.update(persons).set({ displayName: 'Alice' }).where(eq(persons.id, a.personId));

    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner' },
    });
    expect(mint.status).toBe(200);

    // No `token:` in the call — verify the public mount is wired correctly.
    const preview = await call(app, `/api/invites/${mint.body.token}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.kind).toBe('partner');
    expect(preview.body.inviterDisplayName).toBe('Alice');
    expect(preview.body.relationshipType).toBe('partnership');
    expect(preview.body.expiresAt).toBeDefined();
  });

  it('preview for a pod invite reveals pod name but NOT pod members', async () => {
    const app = newApp();
    const a = await authed();
    const b = await authed();
    const outsider = await authed();
    await db.update(persons).set({ displayName: 'Alice' }).where(eq(persons.id, a.personId));
    await db.update(persons).set({ displayName: 'Bellatrix-unique' }).where(eq(persons.id, b.personId));

    const pod = await call(app, '/api/pods', {
      method: 'POST',
      token: a.sessionToken,
      json: { name: 'Hearth' },
    });
    const podId = pod.body.pod.id;

    // Get B into the pod so we can later check B's name doesn't leak.
    const bInv = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'pod', podId },
    });
    await call(app, `/api/invites/${bInv.body.token}/accept`, {
      method: 'POST',
      token: b.sessionToken,
    });

    // Now mint another invite to share with an outsider, and preview it.
    const outsiderInv = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'pod', podId },
    });

    // Outsider previews WITHOUT joining.
    const preview = await call(app, `/api/invites/${outsiderInv.body.token}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.kind).toBe('pod');
    expect(preview.body.podName).toBe('Hearth');
    expect(preview.body.inviterDisplayName).toBe('Alice');
    // Privacy: must not enumerate pod members.
    expect(JSON.stringify(preview.body)).not.toContain('Bellatrix-unique');
    // And no relationshipType on a pod invite.
    expect(preview.body.relationshipType).toBeUndefined();
    void outsider; // outsider session never needed to read preview
  });

  it('preview never includes the inviter-private displayHint', async () => {
    const app = newApp();
    const a = await authed();

    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner', displayHint: 'private-label-for-sam' },
    });
    const preview = await call(app, `/api/invites/${mint.body.token}/preview`);
    expect(JSON.stringify(preview.body)).not.toContain('private-label-for-sam');
  });

  it('preview 404s on unknown tokens', async () => {
    const app = newApp();
    const r = await call(app, '/api/invites/nope-not-a-real-token-zzz/preview');
    expect(r.status).toBe(404);
  });

  it('preview 404s on revoked invites', async () => {
    const app = newApp();
    const a = await authed();
    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner' },
    });
    const rev = await call(app, `/api/invites/${mint.body.token}`, {
      method: 'DELETE',
      token: a.sessionToken,
    });
    expect(rev.status).toBe(200);
    const preview = await call(app, `/api/invites/${mint.body.token}/preview`);
    expect(preview.status).toBe(404);
  });

  it('preview 409s on already-accepted invites', async () => {
    const app = newApp();
    const a = await authed();
    const b = await authed();
    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner' },
    });
    await call(app, `/api/invites/${mint.body.token}/accept`, {
      method: 'POST',
      token: b.sessionToken,
    });
    const preview = await call(app, `/api/invites/${mint.body.token}/preview`);
    expect(preview.status).toBe(409);
  });
});

describe('invites — cold signup-on-accept', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('a brand-new email can preview, then sign up, then accept the invite', async () => {
    const app = newApp();
    // Existing user mints a partner invite.
    const inviterEmail = uniqueEmail('inv-cold');
    created.push(inviterEmail);
    const inviter = await createTestPerson(inviterEmail);

    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: inviter.sessionToken,
      json: { kind: 'partner', displayHint: 'My new partner' },
    });
    expect(mint.status).toBe(200);
    const inviteToken = mint.body.token as string;

    // Cold user starts: preview is reachable with no session.
    const preview = await call(app, `/api/invites/${inviteToken}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.kind).toBe('partner');

    // Cold signup via standard login-code flow.
    const newEmail = uniqueEmail('cold-signup');
    created.push(newEmail);
    const codeReq = await call(app, '/auth/magic-link', {
      method: 'POST',
      json: { email: newEmail },
    });
    expect(codeReq.status).toBe(200);
    expect(codeReq.body.devToken).toBeDefined();

    const verify = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email: newEmail, token: codeReq.body.devToken },
    });
    expect(verify.status).toBe(200);
    const newSession = verify.body.sessionToken as string;
    // The verify path auto-created a Person because the email was new.
    const newPersonRows = await db.select().from(persons).where(eq(persons.email, newEmail)).limit(1);
    expect(newPersonRows).toHaveLength(1);

    // Now apply the invite with the fresh session.
    const accept = await call(app, `/api/invites/${inviteToken}/accept`, {
      method: 'POST',
      token: newSession,
    });
    expect(accept.status).toBe(200);
    expect(accept.body.kind).toBe('partner');
    expect(accept.body.partnershipId).toBeDefined();

    // The new user now sees the partnership.
    const list = await call(app, '/api/partners', { token: newSession });
    expect(list.status).toBe(200);
    expect(list.body.partners).toHaveLength(1);
  });
});

describe('invites — revoke / list / authorization', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authed(): Promise<{ sessionToken: string; personId: string }> {
    const email = uniqueEmail('inv-auth');
    created.push(email);
    return createTestPerson(email);
  }

  it('only the inviter can revoke', async () => {
    const app = newApp();
    const a = await authed();
    const b = await authed();
    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner' },
    });

    // B (not the inviter) attempts to revoke → 403.
    const bRev = await call(app, `/api/invites/${mint.body.token}`, {
      method: 'DELETE',
      token: b.sessionToken,
    });
    expect(bRev.status).toBe(403);

    // A revokes → 200.
    const aRev = await call(app, `/api/invites/${mint.body.token}`, {
      method: 'DELETE',
      token: a.sessionToken,
    });
    expect(aRev.status).toBe(200);

    // Subsequent accept fails with 404 (revoked == invisible).
    const acc = await call(app, `/api/invites/${mint.body.token}/accept`, {
      method: 'POST',
      token: b.sessionToken,
    });
    expect(acc.status).toBe(404);
  });

  it('cannot revoke an already-accepted invite', async () => {
    const app = newApp();
    const a = await authed();
    const b = await authed();
    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner' },
    });
    await call(app, `/api/invites/${mint.body.token}/accept`, {
      method: 'POST',
      token: b.sessionToken,
    });
    const rev = await call(app, `/api/invites/${mint.body.token}`, {
      method: 'DELETE',
      token: a.sessionToken,
    });
    expect(rev.status).toBe(409);
  });

  it('listMine returns invites I created (with status)', async () => {
    const app = newApp();
    const a = await authed();
    const b = await authed();

    const open = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner', displayHint: 'open one' },
    });
    const accepted = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner', displayHint: 'accepted one' },
    });
    await call(app, `/api/invites/${accepted.body.token}/accept`, {
      method: 'POST',
      token: b.sessionToken,
    });

    const list = await call(app, '/api/invites', { token: a.sessionToken });
    expect(list.status).toBe(200);
    expect(list.body.invites).toHaveLength(2);
    const labels = list.body.invites.map((i: any) => i.displayHint);
    expect(labels).toContain('open one');
    expect(labels).toContain('accepted one');
    const acceptedRow = list.body.invites.find((i: any) => i.displayHint === 'accepted one');
    expect(acceptedRow.acceptedAt).not.toBeNull();
    void open;
  });

  it('non-pod-members cannot mint a pod invite (horizontal but still requires membership)', async () => {
    const app = newApp();
    const a = await authed();
    const outsider = await authed();
    const pod = await call(app, '/api/pods', {
      method: 'POST',
      token: a.sessionToken,
      json: { name: 'Treehouse' },
    });
    const podId = pod.body.pod.id;

    const r = await call(app, '/api/invites', {
      method: 'POST',
      token: outsider.sessionToken,
      json: { kind: 'pod', podId },
    });
    expect(r.status).toBe(403);
  });

  it('any pod member (not just creator) can mint a pod invite — pods are horizontal', async () => {
    const app = newApp();
    const a = await authed();
    const b = await authed();
    const c = await authed();
    const pod = await call(app, '/api/pods', {
      method: 'POST',
      token: a.sessionToken,
      json: { name: 'Cottage' },
    });
    const podId = pod.body.pod.id;

    // A invites B (creator inviting).
    const inv1 = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'pod', podId },
    });
    await call(app, `/api/invites/${inv1.body.token}/accept`, {
      method: 'POST',
      token: b.sessionToken,
    });

    // B (not creator, just a member) invites C — should succeed.
    const inv2 = await call(app, '/api/invites', {
      method: 'POST',
      token: b.sessionToken,
      json: { kind: 'pod', podId },
    });
    expect(inv2.status).toBe(200);
    const accept = await call(app, `/api/invites/${inv2.body.token}/accept`, {
      method: 'POST',
      token: c.sessionToken,
    });
    expect(accept.status).toBe(200);
  });

  it('rejects self-accept', async () => {
    const app = newApp();
    const a = await authed();
    const mint = await call(app, '/api/invites', {
      method: 'POST',
      token: a.sessionToken,
      json: { kind: 'partner' },
    });
    const r = await call(app, `/api/invites/${mint.body.token}/accept`, {
      method: 'POST',
      token: a.sessionToken,
    });
    expect(r.status).toBe(400);
  });
});
