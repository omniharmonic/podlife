/**
 * Telegram linking routes (P7.1):
 *   POST /api/me/telegram/link/start    → mint a one-time deep link token
 *   POST /api/me/telegram/disconnect    → clear telegram_chat_id
 *   POST /api/pods/:id/telegram/link/start → mint a pod-link token (admin only)
 *
 * All three return 503 with a clear message when Telegram is disabled.
 */
import { Hono } from 'hono';
import { and, eq, isNotNull } from 'drizzle-orm';
import { config } from '../../lib/config.js';
import { db } from '../../db/index.js';
import { podMembers } from '../../db/schema.js';
import { AppError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import {
  createLinkToken,
  createPodLinkToken,
  disconnectTelegramChat,
} from './telegram.bot.js';

class TelegramDisabledError extends AppError {
  constructor() {
    super('TELEGRAM_DISABLED', 'Telegram bot is not configured on this server', 503);
  }
}

export const telegramLinkRoutes = new Hono();

telegramLinkRoutes.post('/me/telegram/link/start', async (c) => {
  if (!config.telegram.enabled) throw new TelegramDisabledError();
  const me = c.get('person');
  const { token, expiresInSeconds } = await createLinkToken(me.id);
  const username = config.telegram.botUsername || 'pod_life_bot';
  const deepLink = `https://t.me/${username}?start=${token}`;
  return c.json({ deepLink, token, expiresInSeconds });
});

telegramLinkRoutes.post('/me/telegram/disconnect', async (c) => {
  if (!config.telegram.enabled) throw new TelegramDisabledError();
  const me = c.get('person');
  await disconnectTelegramChat(me.id);
  return c.json({ ok: true });
});

/**
 * Pod-link token: an admin in the web UI calls this, then types
 * `/pod link <token>` in the Telegram group chat.
 */
export const telegramPodLinkRoutes = new Hono();
telegramPodLinkRoutes.post('/:id/telegram/link/start', async (c) => {
  if (!config.telegram.enabled) throw new TelegramDisabledError();
  const me = c.get('person');
  const podId = c.req.param('id');
  if (!podId) throw new NotFoundError();
  // Admin check.
  const rows = await db
    .select()
    .from(podMembers)
    .where(
      and(
        eq(podMembers.podId, podId),
        eq(podMembers.personId, me.id),
        isNotNull(podMembers.joinedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new ForbiddenError('Not a member of this pod');
  if (row.role !== 'admin') throw new ForbiddenError('Admin access required');

  const { token, expiresInSeconds } = await createPodLinkToken(podId);
  return c.json({
    token,
    expiresInSeconds,
    instructions: `In the pod's Telegram group, an admin should type: /pod link ${token}`,
  });
});
