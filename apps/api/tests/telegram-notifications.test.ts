/**
 * Telegram notification dispatch tests.
 *
 * Use a stub transport (setTelegramTransport) so we don't need a real bot
 * token. Assert:
 *   - DM to person without telegram link → not contacted via telegram
 *   - DM to person opted-in → received
 *   - DM to person without 'telegram' in notification_channels → not received
 *   - Privacy violation → not delivered, audit row written
 */
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import { db } from '../src/db/index.ts';
import { auditLog, partnerships, persons } from '../src/db/schema.ts';
import {
  sendDmToPerson,
  setTelegramTransport,
  type TelegramTransport,
} from '../src/services/notification/telegram.adapter.ts';
import { send as notify } from '../src/services/notification/notification.service.ts';

function makeStubTransport(): TelegramTransport & { sent: Array<{ chatId: string; text: string }> } {
  const sent: Array<{ chatId: string; text: string }> = [];
  return {
    sent,
    async sendMessage(chatId, text) {
      sent.push({ chatId: String(chatId), text });
    },
  };
}

async function bootPerson(displayName: string): Promise<{ id: string; email: string }> {
  const app = newApp();
  const email = uniqueEmail('tgn');
  const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
  const v = await call(app, '/auth/verify', {
    method: 'POST',
    json: { email, token: r.body.devToken },
  });
  const id = v.body.person.id as string;
  await db.update(persons).set({ displayName }).where(eq(persons.id, id));
  return { id, email };
}

describe('telegram notification dispatch', () => {
  const created: string[] = [];
  afterEach(async () => {
    setTelegramTransport(null);
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('skips telegram when person has no chat id', async () => {
    const stub = makeStubTransport();
    setTelegramTransport(stub);

    const a = await bootPerson('NoLinkPerson');
    created.push(a.email);

    const result = await sendDmToPerson(a.id, { text: 'hello NoLinkPerson' });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('no_chat_id');
    expect(stub.sent).toHaveLength(0);
  });

  it('skips telegram when channel is not enabled', async () => {
    const stub = makeStubTransport();
    setTelegramTransport(stub);

    const a = await bootPerson('OptedOutPerson');
    created.push(a.email);
    // Has chat id but channel is in_app only.
    await db
      .update(persons)
      .set({ telegramChatId: BigInt(1001), notificationChannels: ['in_app'] })
      .where(eq(persons.id, a.id));

    const result = await sendDmToPerson(a.id, { text: 'hi OptedOutPerson' });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('channel_disabled');
    expect(stub.sent).toHaveLength(0);
  });

  it('delivers a DM when linked and opted-in', async () => {
    const stub = makeStubTransport();
    setTelegramTransport(stub);

    const a = await bootPerson('LinkedPerson');
    created.push(a.email);
    await db
      .update(persons)
      .set({ telegramChatId: BigInt(2002), notificationChannels: ['in_app', 'telegram'] })
      .where(eq(persons.id, a.id));

    const result = await sendDmToPerson(a.id, { text: 'hi LinkedPerson' });
    expect(result.delivered).toBe(true);
    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0]?.chatId).toBe('2002');

    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.personId, a.id), eq(auditLog.action, 'telegram_send')));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('refuses to send a DM that mentions a non-partner; logs audit row', async () => {
    const stub = makeStubTransport();
    setTelegramTransport(stub);

    const a = await bootPerson('Aurelius2');
    const b = await bootPerson('Bellatrix2');
    const c = await bootPerson('Caspian2'); // unrelated to A
    created.push(a.email, b.email, c.email);

    // Partnership A-B (active).
    const [aSort, bSort] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await db.insert(partnerships).values({
      personAId: aSort,
      personBId: bSort,
      status: 'active',
      invitedBy: a.id,
    });

    await db
      .update(persons)
      .set({ telegramChatId: BigInt(3003), notificationChannels: ['in_app', 'telegram'] })
      .where(eq(persons.id, a.id));

    const result = await sendDmToPerson(a.id, {
      text: 'Aurelius2 — heads up: Caspian2 is busy tonight.',
    });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('privacy_violation');
    expect(stub.sent).toHaveLength(0);

    const violation = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.personId, a.id),
          eq(auditLog.action, 'telegram_privacy_violation'),
        ),
      );
    expect(violation.length).toBeGreaterThan(0);
  });

  it('notification.service does not contact telegram for un-linked persons', async () => {
    const stub = makeStubTransport();
    setTelegramTransport(stub);

    const a = await bootPerson('UnlinkedPerson');
    created.push(a.email);

    await notify(a.id, {
      title: 'Test',
      body: 'Test notification',
    });
    expect(stub.sent).toHaveLength(0);
  });
});
