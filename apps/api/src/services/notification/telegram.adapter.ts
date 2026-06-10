/**
 * Telegram notification adapter (P7.2).
 *
 * Provides DM and group-chat dispatch with mandatory privacy validation
 * (CLAUDE.md § Telegram Message Content). Every send goes through the
 * matching privacy filter and writes an audit_log row.
 *
 * Tests can swap out the underlying transport via setTelegramTransport().
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { runWithServiceContext } from '../../db/rls.js';
import { auditLog, persons, pods } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import {
  dmPrivacyFilter,
  groupPrivacyFilter,
} from '../../modules/telegram/privacy.js';
import { getBot } from '../../modules/telegram/telegram.bot.js';

// ─── Telegram message API surface ──────────────────────────────────────

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export type InlineKeyboard = InlineButton[][];

export interface TelegramSendOptions {
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  replyMarkup?: { inline_keyboard: InlineKeyboard };
  resourceId?: string | null;
  cycleId?: string | null;
}

// ─── Pluggable transport (test injection) ──────────────────────────────

export interface TelegramTransport {
  sendMessage(
    chatId: bigint | number,
    text: string,
    options?: { parse_mode?: string; reply_markup?: unknown },
  ): Promise<unknown>;
}

let transportOverride: TelegramTransport | null = null;

/**
 * Replace the underlying transport (used in tests). Pass `null` to restore
 * the live grammy bot transport.
 */
export function setTelegramTransport(t: TelegramTransport | null): void {
  transportOverride = t;
}

function getTransport(): TelegramTransport | null {
  if (transportOverride) return transportOverride;
  const bot = getBot();
  if (!bot) return null;
  return {
    async sendMessage(chatId, text, options) {
      // grammy's bot.api.sendMessage accepts number | string; bigint chatIds
      // (Telegram group chats can be < -2^31) must be converted carefully.
      const id =
        typeof chatId === 'bigint'
          ? // Telegram group chat IDs do fit in JS Number safely (53-bit), but cast to string for grammy.
            chatId.toString()
          : chatId;
      return await bot.api.sendMessage(id, text, options as Parameters<typeof bot.api.sendMessage>[2]);
    },
  };
}

// ─── DM dispatch ───────────────────────────────────────────────────────

export interface DmPayload {
  text: string;
  replyMarkup?: { inline_keyboard: InlineKeyboard };
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  cycleId?: string | null;
}

export interface DmResult {
  delivered: boolean;
  reason?: string;
}

/**
 * Send a DM to `personId` over Telegram.
 *
 * Skips silently (returns delivered:false) if:
 *   - Telegram is not configured
 *   - The person has no telegram_chat_id
 *   - 'telegram' is not in their notification_channels
 *
 * Throws (does not silently swallow) on a privacy validation failure: this
 * means a developer added a code path that may leak. The caller should
 * decide whether to bubble or log; we record an audit row regardless.
 */
export async function sendDmToPerson(
  personId: string,
  payload: DmPayload,
): Promise<DmResult> {
  // The privacy filter validates against the TARGET person's graph (their
  // partners). Callers may be authenticated requests scoped to a DIFFERENT
  // person via RLS, which would make the filter read the wrong graph and
  // fail-closed. Run the whole dispatch as trusted server code so the filter
  // sees the recipient's true relationships.
  return runWithServiceContext(() => sendDmToPersonImpl(personId, payload));
}

async function sendDmToPersonImpl(
  personId: string,
  payload: DmPayload,
): Promise<DmResult> {
  const transport = getTransport();
  if (!transport) {
    return { delivered: false, reason: 'telegram_disabled' };
  }
  const rows = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  const person = rows[0];
  if (!person) return { delivered: false, reason: 'person_not_found' };
  if (!person.telegramChatId) {
    return { delivered: false, reason: 'no_chat_id' };
  }
  const channels = person.notificationChannels ?? [];
  if (!channels.includes('telegram')) {
    return { delivered: false, reason: 'channel_disabled' };
  }

  // Privacy validation FIRST — never send a non-validated message.
  const verdict = await dmPrivacyFilter.validate(personId, payload.text);
  if (!verdict.ok) {
    logger.error('telegram_privacy_violation (dm)', {
      personId,
      reason: verdict.reason,
    });
    await db.insert(auditLog).values({
      personId,
      action: 'telegram_privacy_violation',
      resourceType: 'notification',
      resourceId: payload.cycleId ?? null,
      metadata: { channel: 'dm', reason: verdict.reason ?? '' },
    });
    return { delivered: false, reason: 'privacy_violation' };
  }

  try {
    await transport.sendMessage(person.telegramChatId, payload.text, {
      parse_mode: payload.parseMode,
      reply_markup: payload.replyMarkup,
    });
    await db.insert(auditLog).values({
      personId,
      action: 'telegram_send',
      resourceType: 'notification',
      resourceId: payload.cycleId ?? null,
      metadata: {
        chatId: person.telegramChatId.toString(),
        channel: 'dm',
      },
    });
    return { delivered: true };
  } catch (err) {
    logger.error('telegram dm send failed', {
      personId,
      err: (err as Error).message,
    });
    return { delivered: false, reason: 'transport_error' };
  }
}

// ─── Pod group dispatch ────────────────────────────────────────────────

export interface PodGroupPayload {
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  replyMarkup?: { inline_keyboard: InlineKeyboard };
}

export async function notifyPodGroup(
  podId: string,
  payload: PodGroupPayload,
): Promise<DmResult> {
  // Group filter reads pod membership (RLS-protected); run as trusted server
  // code so it validates against the full pod regardless of caller context.
  return runWithServiceContext(() => notifyPodGroupImpl(podId, payload));
}

async function notifyPodGroupImpl(
  podId: string,
  payload: PodGroupPayload,
): Promise<DmResult> {
  const transport = getTransport();
  if (!transport) return { delivered: false, reason: 'telegram_disabled' };

  const rows = await db.select().from(pods).where(eq(pods.id, podId)).limit(1);
  const pod = rows[0];
  if (!pod) return { delivered: false, reason: 'pod_not_found' };
  if (!pod.telegramGroupChatId) return { delivered: false, reason: 'no_group_chat' };

  const verdict = await groupPrivacyFilter.validate(podId, payload.text);
  if (!verdict.ok) {
    logger.error('telegram_privacy_violation (group)', {
      podId,
      reason: verdict.reason,
    });
    await db.insert(auditLog).values({
      personId: null,
      action: 'telegram_privacy_violation',
      resourceType: 'pod',
      resourceId: podId,
      metadata: { channel: 'group', reason: verdict.reason ?? '' },
    });
    return { delivered: false, reason: 'privacy_violation' };
  }

  try {
    await transport.sendMessage(pod.telegramGroupChatId, payload.text, {
      parse_mode: payload.parseMode,
      reply_markup: payload.replyMarkup,
    });
    await db.insert(auditLog).values({
      personId: null,
      action: 'telegram_send',
      resourceType: 'pod',
      resourceId: podId,
      metadata: {
        chatId: pod.telegramGroupChatId.toString(),
        channel: 'group',
      },
    });
    return { delivered: true };
  } catch (err) {
    logger.error('telegram group send failed', {
      podId,
      err: (err as Error).message,
    });
    return { delivered: false, reason: 'transport_error' };
  }
}

export const telegramAdapter = {
  sendDmToPerson,
  notifyPodGroup,
  isEnabled: (): boolean => config.telegram.enabled || transportOverride !== null,
};
