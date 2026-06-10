/**
 * Telegram webhook receiver. Mounted at POST /telegram/webhook/:secret.
 *
 * The URL secret matches TELEGRAM_WEBHOOK_SECRET. If it doesn't match, we
 * 404 — never reveal that the path exists. We additionally verify the
 * X-Telegram-Bot-Api-Secret-Token header (Telegram's official mechanism).
 */
import { Hono } from 'hono';
import { webhookCallback } from 'grammy';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { getBot } from './telegram.bot.js';
import { runWithServiceContext } from '../../db/rls.js';
import { safeEqual } from '../../lib/timing.js';
import { NotFoundError } from '../../lib/errors.js';

export const telegramWebhookRoutes = new Hono();

telegramWebhookRoutes.post('/:secret', async (c) => {
  if (!config.telegram.enabled || !config.telegram.webhookSecret) {
    throw new NotFoundError();
  }
  const secret = c.req.param('secret');
  if (!safeEqual(secret, config.telegram.webhookSecret)) {
    throw new NotFoundError();
  }
  const bot = getBot();
  if (!bot) throw new NotFoundError();

  // Lazily construct the Hono adapter on first hit.
  const handler = webhookCallback(bot, 'hono', {
    secretToken: config.telegram.webhookSecret,
  });
  try {
    // The bot is unauthenticated (no person context) but is trusted server
    // code that does its own pod/partnership scoping. Run under service
    // context so its cross-person lookups aren't blocked by deny-by-default RLS.
    return await runWithServiceContext(() => handler(c));
  } catch (err) {
    logger.error('telegram webhook error', { err: (err as Error).message });
    return c.json({ ok: false }, 500);
  }
});
