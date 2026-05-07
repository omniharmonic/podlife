/**
 * Telegram link flow tests.
 *
 * Even without a real TELEGRAM_BOT_TOKEN we can exercise:
 *  - createLinkToken / consumeLinkToken (Redis round-trip)
 *  - associateTelegramChat (DB write + audit row)
 *  - disconnectTelegramChat
 *
 * The HTTP route POST /api/me/telegram/link/start returns 503 without a
 * token; we cover that branch too. With a token (set via env BEFORE config
 * is loaded) the route mints a deep link.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import { db } from '../src/db/index.ts';
import { auditLog, persons } from '../src/db/schema.ts';
import {
  associateTelegramChat,
  consumeLinkToken,
  createLinkToken,
  disconnectTelegramChat,
} from '../src/modules/telegram/telegram.bot.ts';
import { config } from '../src/lib/config.ts';

describe('telegram link flow', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  beforeAll(() => {
    // Tests don't need a real bot — but they DO require Redis (already running for other tests).
  });

  it('mints + consumes a link token and associates the chat id', async () => {
    const app = newApp();
    const email = uniqueEmail('tglink');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const personId = v.body.person.id as string;

    const { token } = await createLinkToken(personId);
    expect(token).toMatch(/^[A-Za-z0-9]+$/);

    // Consume should return the personId once and only once.
    const got = await consumeLinkToken(token);
    expect(got).toBe(personId);
    const second = await consumeLinkToken(token);
    expect(second).toBeNull();

    // Associating: DB row updated + audit row exists.
    await associateTelegramChat(personId, BigInt(123_456_789), 'alex_handle');
    const rows = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
    expect(rows[0]?.telegramChatId).toBe(BigInt(123_456_789));
    expect(rows[0]?.telegramHandle).toBe('alex_handle');
    expect(rows[0]?.notificationChannels?.includes('telegram')).toBe(true);

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.personId, personId));
    expect(audit.some((a) => a.action === 'telegram_link')).toBe(true);

    // Disconnect clears it.
    await disconnectTelegramChat(personId);
    const rows2 = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
    expect(rows2[0]?.telegramChatId).toBeNull();
    expect(rows2[0]?.notificationChannels?.includes('telegram')).toBe(false);
  });

  it('POST /api/me/telegram/link/start returns 503 without a bot token', async (ctx) => {
    if (config.telegram.enabled) {
      ctx.skip();
      return;
    }
    const app = newApp();
    const email = uniqueEmail('tg503');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const tok = v.body.sessionToken as string;

    const res = await call(app, '/api/me/telegram/link/start', {
      method: 'POST',
      token: tok,
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TELEGRAM_DISABLED');
  });

  it('POST /api/me/telegram/link/start mints a deep link when bot is enabled', async (ctx) => {
    if (!config.telegram.enabled) {
      ctx.skip();
      return;
    }
    const app = newApp();
    const email = uniqueEmail('tglnk');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const tok = v.body.sessionToken as string;

    const res = await call(app, '/api/me/telegram/link/start', {
      method: 'POST',
      token: tok,
    });
    expect(res.status).toBe(200);
    expect(res.body.deepLink).toMatch(/^https:\/\/t\.me\//);
    expect(res.body.token).toBeDefined();
    expect(res.body.expiresInSeconds).toBeGreaterThan(0);
  });
});
