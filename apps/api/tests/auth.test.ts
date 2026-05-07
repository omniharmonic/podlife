import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import { db } from '../src/db/index.ts';
import { magicLinks } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

describe('auth', () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const e of created.splice(0)) {
      await deletePerson(e);
      await db.delete(magicLinks).where(eq(magicLinks.email, e));
    }
  });

  it('requests a magic link, verifies, and returns a session', async () => {
    const app = newApp();
    const email = uniqueEmail();
    created.push(email);

    const r1 = await call(app, '/auth/magic-link', {
      method: 'POST',
      json: { email },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.devToken).toBeDefined();

    const r2 = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r1.body.devToken },
    });
    expect(r2.status).toBe(200);
    expect(r2.body.sessionToken).toBeDefined();
    expect(r2.body.person.email).toBe(email);

    const r3 = await call(app, '/api/me', { token: r2.body.sessionToken });
    expect(r3.status).toBe(200);
    expect(r3.body.person.email).toBe(email);
  });

  it('rejects invalid magic link tokens', async () => {
    const app = newApp();
    const email = uniqueEmail();
    created.push(email);

    await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const r = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: 'bogus_value_with_enough_length' },
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_MAGIC_LINK');
  });

  it('prevents replay (used token cannot be re-used)', async () => {
    const app = newApp();
    const email = uniqueEmail();
    created.push(email);

    const req = await call(app, '/auth/magic-link', {
      method: 'POST',
      json: { email },
    });
    const token = req.body.devToken;

    const v1 = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token },
    });
    expect(v1.status).toBe(200);

    const v2 = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token },
    });
    expect(v2.status).toBe(401);
  });

  it('rejects API access without a session token', async () => {
    const app = newApp();
    const r = await call(app, '/api/me');
    expect(r.status).toBe(401);
  });

  it('logout invalidates the session', async () => {
    const app = newApp();
    const email = uniqueEmail();
    created.push(email);

    const req = await call(app, '/auth/magic-link', {
      method: 'POST',
      json: { email },
    });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: req.body.devToken },
    });
    const token = v.body.sessionToken;

    const me1 = await call(app, '/api/me', { token });
    expect(me1.status).toBe(200);

    const out = await call(app, '/auth/logout', {
      method: 'POST',
      token,
    });
    expect(out.status).toBe(200);

    const me2 = await call(app, '/api/me', { token });
    expect(me2.status).toBe(401);
  });

  it('updates and returns the current person', async () => {
    const app = newApp();
    const email = uniqueEmail();
    created.push(email);

    const req = await call(app, '/auth/magic-link', {
      method: 'POST',
      json: { email },
    });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: req.body.devToken },
    });
    const token = v.body.sessionToken;

    const patch = await call(app, '/api/me', {
      method: 'PATCH',
      token,
      json: { displayName: 'Alice', timezone: 'America/Los_Angeles' },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.person.displayName).toBe('Alice');
    expect(patch.body.person.timezone).toBe('America/Los_Angeles');
  });
});
