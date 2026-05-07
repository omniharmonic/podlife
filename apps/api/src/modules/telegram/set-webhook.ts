/**
 * One-shot script: register the Telegram webhook URL with Bot API.
 *
 * Usage:
 *   pnpm --filter @pod-life/api telegram:set-webhook
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_URL    (e.g. https://api.example.com/telegram/webhook/<secret>)
 *   TELEGRAM_WEBHOOK_SECRET (will be sent in X-Telegram-Bot-Api-Secret-Token)
 *
 * No-op when any of the above are unset.
 */
import { config } from '../../lib/config.js';

async function main(): Promise<void> {
  if (!config.telegram.enabled) {
    // eslint-disable-next-line no-console
    console.log('TELEGRAM_BOT_TOKEN not set — nothing to do.');
    return;
  }
  if (!config.telegram.webhookUrl || !config.telegram.webhookSecret) {
    // eslint-disable-next-line no-console
    console.log(
      'TELEGRAM_WEBHOOK_URL or TELEGRAM_WEBHOOK_SECRET not set — nothing to do.',
    );
    return;
  }
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`;
  const body = {
    url: config.telegram.webhookUrl,
    secret_token: config.telegram.webhookSecret,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(json, null, 2));
  if (!res.ok || !(json as { ok: boolean }).ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
