/**
 * Notification service. Always persists an in_app row. If the person opted
 * into the 'telegram' channel and has a linked chat id, ALSO dispatches a
 * Telegram DM via the adapter. Failures are logged best-effort, not bubbled.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { notifications, persons } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { sendDmToPerson } from './telegram.adapter.js';

export interface NotificationPayload {
  title: string;
  body: string;
  actionUrl?: string;
  /**
   * Optional list of channels to also dispatch through. If undefined we
   * use the person's notification_channels preference. Use `[]` to force
   * in-app only.
   */
  channels?: Array<'in_app' | 'telegram' | 'push'>;
  cycleId?: string | null;
}

export async function send(personId: string, payload: NotificationPayload): Promise<void> {
  await db.insert(notifications).values({
    personId,
    channel: 'in_app',
    title: payload.title,
    body: payload.body,
    actionUrl: payload.actionUrl ?? null,
    deliveredAt: new Date(),
  });

  // Compute the actual channel set.
  let channels = payload.channels;
  if (channels === undefined) {
    const rows = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
    channels = (rows[0]?.notificationChannels ?? ['in_app']) as Array<
      'in_app' | 'telegram' | 'push'
    >;
  }

  if (channels.includes('telegram')) {
    try {
      const text = payload.actionUrl
        ? `${payload.title}\n\n${payload.body}\n\n${payload.actionUrl}`
        : `${payload.title}\n\n${payload.body}`;
      await sendDmToPerson(personId, { text, cycleId: payload.cycleId ?? null });
    } catch (err) {
      logger.warn('telegram dm dispatch failed (best effort)', {
        personId,
        err: (err as Error).message,
      });
    }
  }
}
