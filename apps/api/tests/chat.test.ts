/**
 * Pod chat integration tests.
 *
 * Covers:
 *  - Two pod members can post + read messages.
 *  - A non-member receives 403 on GET/POST.
 *  - Author can delete own message; non-author cannot.
 *  - Body length validation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

async function authed(
  app: ReturnType<typeof newApp>,
  prefix: string,
  created: string[],
): Promise<string> {
  const email = uniqueEmail(prefix);
  created.push(email);
  const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
  const v = await call(app, '/auth/verify', {
    method: 'POST',
    json: { email, token: r.body.devToken },
  });
  return v.body.sessionToken;
}

async function makePodWithTwo(
  app: ReturnType<typeof newApp>,
  created: string[],
): Promise<{ podId: string; aTok: string; bTok: string }> {
  const aTok = await authed(app, 'chat-a', created);
  const bTok = await authed(app, 'chat-b', created);
  const pod = await call(app, '/api/pods', {
    method: 'POST',
    token: aTok,
    json: { name: `ChatPod-${Date.now()}` },
  });
  expect(pod.status).toBe(200);
  const podId: string = pod.body.pod.id;
  const inv = await call(app, '/api/invites', {
    method: 'POST',
    token: aTok,
    json: { kind: 'pod', podId: podId },
  });
  await call(app, `/api/invites/${inv.body.token}/accept`, {
    method: 'POST',
    token: bTok,
  });
  return { podId, aTok, bTok };
}

describe('pod chat', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('two pod members can post and read messages (newest-last ordering)', async () => {
    const app = newApp();
    const { podId, aTok, bTok } = await makePodWithTwo(app, created);

    const m1 = await call(app, `/api/pods/${podId}/chat`, {
      method: 'POST',
      token: aTok,
      json: { body: 'Hello pod' },
    });
    expect(m1.status).toBe(200);
    expect(m1.body.message.body).toBe('Hello pod');
    expect(m1.body.message.authorName).toBeTruthy();

    const m2 = await call(app, `/api/pods/${podId}/chat`, {
      method: 'POST',
      token: bTok,
      json: { body: 'Hi from B' },
    });
    expect(m2.status).toBe(200);

    const list = await call(app, `/api/pods/${podId}/chat`, { token: aTok });
    expect(list.status).toBe(200);
    expect(list.body.messages).toHaveLength(2);
    // Newest-last: index 0 is the older, index 1 is the newer.
    expect(list.body.messages[0].body).toBe('Hello pod');
    expect(list.body.messages[1].body).toBe('Hi from B');
  });

  it('non-member receives 403 on GET and POST', async () => {
    const app = newApp();
    const { podId } = await makePodWithTwo(app, created);
    const cTok = await authed(app, 'chat-stranger', created);

    const get = await call(app, `/api/pods/${podId}/chat`, { token: cTok });
    expect(get.status).toBe(403);

    const post = await call(app, `/api/pods/${podId}/chat`, {
      method: 'POST',
      token: cTok,
      json: { body: 'sneaking in' },
    });
    expect(post.status).toBe(403);
  });

  it('author can delete own message; non-author cannot', async () => {
    const app = newApp();
    const { podId, aTok, bTok } = await makePodWithTwo(app, created);
    const m = await call(app, `/api/pods/${podId}/chat`, {
      method: 'POST',
      token: aTok,
      json: { body: 'mine' },
    });
    const messageId: string = m.body.message.id;

    const otherDelete = await call(app, `/api/pods/${podId}/chat/${messageId}`, {
      method: 'DELETE',
      token: bTok,
    });
    expect(otherDelete.status).toBe(403);

    const ownDelete = await call(app, `/api/pods/${podId}/chat/${messageId}`, {
      method: 'DELETE',
      token: aTok,
    });
    expect(ownDelete.status).toBe(204);

    const list = await call(app, `/api/pods/${podId}/chat`, { token: aTok });
    expect(list.body.messages).toHaveLength(0);
  });

  it('rejects body too long or empty', async () => {
    const app = newApp();
    const { podId, aTok } = await makePodWithTwo(app, created);
    const empty = await call(app, `/api/pods/${podId}/chat`, {
      method: 'POST',
      token: aTok,
      json: { body: '' },
    });
    expect(empty.status).toBe(400);

    const tooLong = await call(app, `/api/pods/${podId}/chat`, {
      method: 'POST',
      token: aTok,
      json: { body: 'x'.repeat(2001) },
    });
    expect(tooLong.status).toBe(400);
  });
});
