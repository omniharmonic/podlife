/**
 * Telegram bot setup (P7.1).
 *
 * Single grammy Bot instance, lazily constructed when TELEGRAM_BOT_TOKEN is set.
 * Wires command handlers (/start, /schedule, /status, /help, /disconnect),
 * pod admin commands (/pod link, /pod unlink), the bot-added-to-group event,
 * and inline-keyboard callback queries (proposal:accept, proposal:decline, …).
 *
 * Graceful degradation (CLAUDE.md § Telegram): if no token is set, getBot()
 * returns null and createBot() is a no-op.
 */
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { config } from '../../lib/config.ts';
import { logger } from '../../lib/logger.ts';
import { redis, redisFor } from '../../lib/redis.ts';
import { db } from '../../db/index.ts';
import {
  auditLog,
  partnerships,
  persons,
  podMembers,
  pods,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../../db/schema.ts';

const LINK_TOKEN_KEY = redisFor('tg-link');
const POD_LINK_TOKEN_KEY = redisFor('tg-pod-link');
const STATE_KEY = redisFor('tg-state');

let botInstance: Bot | null = null;
let botStarted = false;

/**
 * Build the bot. Called lazily by getBot(). Returns null when disabled.
 */
export function createBot(): Bot | null {
  if (!config.telegram.enabled) {
    return null;
  }
  if (botInstance) return botInstance;

  const bot = new Bot(config.telegram.botToken);
  registerHandlers(bot);
  botInstance = bot;
  return bot;
}

/**
 * Idempotent accessor for the live bot instance.
 */
export function getBot(): Bot | null {
  if (botInstance) return botInstance;
  return createBot();
}

/**
 * Start polling. Only used for local dev (without webhooks). Webhooks are
 * the production path.
 */
export async function startBotPolling(): Promise<void> {
  const bot = getBot();
  if (!bot || botStarted) return;
  botStarted = true;
  // Don't await `bot.start()` — it resolves only when polling stops.
  void bot.start();
}

export async function stopBot(): Promise<void> {
  if (botInstance && botStarted) {
    try {
      await botInstance.stop();
    } catch {
      /* ignore */
    }
  }
  botInstance = null;
  botStarted = false;
}

// ─── Public helpers used by routes ─────────────────────────────────────

const LINK_TTL_SECONDS = 10 * 60;

export async function createLinkToken(personId: string): Promise<{
  token: string;
  expiresInSeconds: number;
}> {
  const token = randomToken(24);
  await redis.set(LINK_TOKEN_KEY(token), personId, LINK_TTL_SECONDS);
  return { token, expiresInSeconds: LINK_TTL_SECONDS };
}

export async function consumeLinkToken(token: string): Promise<string | null> {
  const key = LINK_TOKEN_KEY(token);
  const personId = await redis.get(key);
  if (personId) await redis.del(key);
  return personId;
}

export async function createPodLinkToken(podId: string): Promise<{
  token: string;
  expiresInSeconds: number;
}> {
  const token = randomToken(20);
  await redis.set(POD_LINK_TOKEN_KEY(token), podId, LINK_TTL_SECONDS);
  return { token, expiresInSeconds: LINK_TTL_SECONDS };
}

export async function consumePodLinkToken(token: string): Promise<string | null> {
  const key = POD_LINK_TOKEN_KEY(token);
  const podId = await redis.get(key);
  if (podId) await redis.del(key);
  return podId;
}

/**
 * Associate a Telegram chat ID with a person. Called from the bot's /start
 * handler AND directly by tests (which don't run a real grammy bot).
 */
export async function associateTelegramChat(
  personId: string,
  chatId: bigint,
  handle: string | null,
): Promise<void> {
  const updates: Record<string, unknown> = { telegramChatId: chatId };
  if (handle) updates.telegramHandle = handle;
  // Ensure 'telegram' is in notification_channels.
  const found = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  const me = found[0];
  if (me) {
    const ch = me.notificationChannels ?? ['in_app'];
    if (!ch.includes('telegram')) {
      updates.notificationChannels = [...ch, 'telegram'];
    }
  }
  await db.update(persons).set(updates).where(eq(persons.id, personId));
  await db.insert(auditLog).values({
    personId,
    action: 'telegram_link',
    resourceType: 'person',
    resourceId: personId,
    metadata: { chatId: chatId.toString() },
  });
}

export async function disconnectTelegramChat(personId: string): Promise<void> {
  const found = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  const me = found[0];
  const channels = (me?.notificationChannels ?? []).filter((c) => c !== 'telegram');
  await db
    .update(persons)
    .set({ telegramChatId: null, notificationChannels: channels.length ? channels : ['in_app'] })
    .where(eq(persons.id, personId));
  await db.insert(auditLog).values({
    personId,
    action: 'telegram_unlink',
    resourceType: 'person',
    resourceId: personId,
    metadata: {},
  });
}

// ─── Handler registration ──────────────────────────────────────────────

function registerHandlers(bot: Bot): void {
  bot.command('start', async (ctx) => {
    const arg = ctx.match?.toString().trim();
    if (!arg) {
      await ctx.reply(
        'Welcome to Pod Life. To link your account, generate a link from the web app and click it.',
      );
      return;
    }
    const personId = await consumeLinkToken(arg);
    if (!personId) {
      await ctx.reply('That link is invalid or has expired. Please request a new one.');
      return;
    }
    if (!ctx.chat) return;
    const chatId = BigInt(ctx.chat.id);
    const handle = ctx.from?.username ?? null;
    await associateTelegramChat(personId, chatId, handle);
    await ctx.reply(
      'Linked. You will now receive Pod Life notifications here. Try /help or /schedule.',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Pod Life — commands:',
        '/schedule — your upcoming time blocks',
        '/status — satisfaction summary',
        '/disconnect — unlink this Telegram account',
        '/help — this message',
      ].join('\n'),
    );
  });

  bot.command('schedule', async (ctx) => {
    const personId = await personIdForCtx(ctx);
    if (!personId) {
      await ctx.reply('I do not recognise this chat. Link your account first.');
      return;
    }
    const blocks = await loadUpcomingBlocksForPerson(personId);
    if (blocks.length === 0) {
      await ctx.reply('No upcoming blocks in the next week.');
      return;
    }
    const lines = blocks.map((b) => formatBlockLine(b));
    await ctx.reply(['Your next 7 days:', ...lines].join('\n'));
  });

  bot.command('status', async (ctx) => {
    const personId = await personIdForCtx(ctx);
    if (!personId) {
      await ctx.reply('I do not recognise this chat. Link your account first.');
      return;
    }
    const summary = await buildSatisfactionSummary(personId);
    await ctx.reply(summary);
  });

  bot.command('disconnect', async (ctx) => {
    const personId = await personIdForCtx(ctx);
    if (!personId) {
      await ctx.reply('Nothing to disconnect.');
      return;
    }
    await disconnectTelegramChat(personId);
    await ctx.reply('Disconnected. Pod Life will no longer message you here.');
  });

  // ─── Pod group commands ────────────────────────────────────────────
  bot.command('pod', async (ctx) => {
    const text = ctx.match?.toString().trim() ?? '';
    const [verb, token] = text.split(/\s+/, 2);
    if (verb === 'link' && token) {
      await handlePodLink(ctx, token);
    } else if (verb === 'unlink') {
      await handlePodUnlink(ctx);
    } else {
      await ctx.reply('Usage: /pod link <token> — or — /pod unlink');
    }
  });

  // Bot added to a group chat → welcome message.
  bot.on('my_chat_member', async (ctx) => {
    try {
      const update = ctx.myChatMember;
      if (!update) return;
      const newStatus = update.new_chat_member.status;
      if (newStatus === 'member' || newStatus === 'administrator') {
        await ctx.reply(
          [
            "I'm Pod Life. To connect this group to a pod, type:",
            '`/pod link <pod-invite-token>`',
            'Only a pod admin can do this. Generate a token in the web app.',
          ].join('\n'),
          { parse_mode: 'Markdown' },
        );
      }
    } catch (err) {
      logger.warn('my_chat_member handler failed', { err: (err as Error).message });
    }
  });

  // ─── Inline keyboard callbacks ─────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      const personId = await personIdForCtx(ctx);
      if (!personId) {
        await ctx.answerCallbackQuery({ text: 'Link your account first.' });
        return;
      }
      if (data.startsWith('proposal:accept:')) {
        const cycleId = data.slice('proposal:accept:'.length);
        const count = await acceptAllForCycle(personId, cycleId);
        await ctx.answerCallbackQuery({ text: `Accepted ${count} blocks.` });
      } else if (data.startsWith('proposal:decline:')) {
        const blockId = data.slice('proposal:decline:'.length);
        await declineBlock(personId, blockId);
        await ctx.answerCallbackQuery({ text: 'Declined.' });
      } else if (data.startsWith('proposal:change:')) {
        const blockId = data.slice('proposal:change:'.length);
        if (ctx.chat) {
          await redis.set(STATE_KEY(String(ctx.chat.id)), `awaiting_change:${blockId}`, 600);
        }
        await ctx.answerCallbackQuery();
        await ctx.reply('Tell me what to change about this block.');
      } else if (data === 'proposal:open') {
        await ctx.answerCallbackQuery({ url: `${config.frontendUrl}/schedule/review` });
      } else {
        await ctx.answerCallbackQuery({ text: 'Unknown action.' });
      }
    } catch (err) {
      logger.error('callback handler failed', { err: (err as Error).message });
      await ctx.answerCallbackQuery({ text: 'Something went wrong.' });
    }
  });

  bot.catch((err) => {
    logger.error('bot uncaught', { err: err.error instanceof Error ? err.error.message : String(err.error) });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────

function randomToken(bytes: number): string {
  // crypto.getRandomValues is available in modern Node; alphabet matches nanoid-friendly.
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of arr) s += alphabet[b % alphabet.length];
  return s;
}

async function personIdForCtx(ctx: Context): Promise<string | null> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return null;
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.telegramChatId, BigInt(chatId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

interface UpcomingBlock {
  id: string;
  eventType: string;
  startTime: Date;
  endTime: Date;
  partnerName: string | null;
}

async function loadUpcomingBlocksForPerson(personId: string): Promise<UpcomingBlock[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const rows = await db
    .select({ tb: timeBlocks })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, personId),
        inArray(timeBlocks.status, ['proposed', 'accepted', 'locked'] as const),
        gte(timeBlocks.endTime, now),
        lte(timeBlocks.startTime, horizon),
      ),
    );

  const out: UpcomingBlock[] = [];
  for (const { tb } of rows) {
    let partnerName: string | null = null;
    if (tb.partnershipId) {
      const partRows = await db
        .select()
        .from(partnerships)
        .where(eq(partnerships.id, tb.partnershipId))
        .limit(1);
      const p = partRows[0];
      if (p) {
        const partnerId = p.personAId === personId ? p.personBId : p.personAId;
        const pr = await db.select().from(persons).where(eq(persons.id, partnerId)).limit(1);
        partnerName = pr[0]?.displayName ?? null;
      }
    }
    out.push({
      id: tb.id,
      eventType: tb.eventType,
      startTime: tb.startTime,
      endTime: tb.endTime,
      partnerName,
    });
  }
  out.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return out.slice(0, 10);
}

function formatBlockLine(b: UpcomingBlock): string {
  const day = b.startTime.toUTCString().slice(0, 16); // e.g. "Tue, 06 May 2025"
  const startTime = `${pad(b.startTime.getUTCHours())}:${pad(b.startTime.getUTCMinutes())}`;
  const partner = b.partnerName ? ` with ${b.partnerName}` : '';
  return `• ${b.eventType}${partner} — ${day} at ${startTime} UTC`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

async function buildSatisfactionSummary(personId: string): Promise<string> {
  // Look at the most recent locked or proposed cycle that includes this person.
  const cycleRows = await db
    .select()
    .from(schedulingCycles)
    .where(inArray(schedulingCycles.status, ['proposed', 'locked'] as const));
  const mine = cycleRows
    .filter((c) => c.personIds.includes(personId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const cycle = mine[0];
  if (!cycle || !cycle.satisfactionReport) {
    return 'No satisfaction data yet — your first cycle has not run.';
  }
  const report = cycle.satisfactionReport as Array<{
    person_id: string;
    overall_pct: number;
    per_partner: Record<string, { pref_pct: number }>;
  }>;
  const mine2 = Array.isArray(report) ? report.find((r) => r.person_id === personId) : undefined;
  if (!mine2) {
    return 'No satisfaction data for you in the latest cycle.';
  }
  const overall = `${Math.round(mine2.overall_pct ?? 0)}%`;
  const lines = [`Overall: ${overall}`];
  if (mine2.per_partner) {
    for (const [partnerId, info] of Object.entries(mine2.per_partner)) {
      const pr = await db.select().from(persons).where(eq(persons.id, partnerId)).limit(1);
      const name = pr[0]?.displayName ?? 'partner';
      lines.push(`${name}: ${Math.round(info.pref_pct ?? 0)}%`);
    }
  }
  return lines.join('\n');
}

async function acceptAllForCycle(personId: string, cycleId: string): Promise<number> {
  // Find all my pending participations in this cycle.
  const myRows = await db
    .select({ blockId: timeBlockParticipants.timeBlockId })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, personId),
        eq(timeBlockParticipants.response, 'pending'),
        eq(timeBlocks.cycleId, cycleId),
      ),
    );
  let count = 0;
  for (const r of myRows) {
    await db
      .update(timeBlockParticipants)
      .set({ response: 'accepted', respondedAt: new Date() })
      .where(
        and(
          eq(timeBlockParticipants.timeBlockId, r.blockId),
          eq(timeBlockParticipants.personId, personId),
        ),
      );
    count++;
    // Promote block to accepted if all participants are in.
    const all = await db
      .select()
      .from(timeBlockParticipants)
      .where(eq(timeBlockParticipants.timeBlockId, r.blockId));
    if (all.every((p) => p.response === 'accepted')) {
      await db.update(timeBlocks).set({ status: 'accepted' }).where(eq(timeBlocks.id, r.blockId));
    }
  }
  return count;
}

async function declineBlock(personId: string, blockId: string): Promise<void> {
  await db
    .update(timeBlockParticipants)
    .set({ response: 'declined', respondedAt: new Date() })
    .where(
      and(
        eq(timeBlockParticipants.timeBlockId, blockId),
        eq(timeBlockParticipants.personId, personId),
      ),
    );
}

async function handlePodLink(ctx: Context, token: string): Promise<void> {
  const personId = await personIdForCtx(ctx);
  if (!personId) {
    await ctx.reply('Link your account first via the web app, then try again.');
    return;
  }
  const podId = await consumePodLinkToken(token);
  if (!podId) {
    await ctx.reply('That pod link token is invalid or has expired.');
    return;
  }
  // Verify admin role.
  const memb = await db
    .select()
    .from(podMembers)
    .where(
      and(
        eq(podMembers.podId, podId),
        eq(podMembers.personId, personId),
        isNotNull(podMembers.joinedAt),
      ),
    )
    .limit(1);
  if (!memb[0] || memb[0].role !== 'admin') {
    await ctx.reply('Only a pod admin can link this group.');
    return;
  }
  if (!ctx.chat) return;
  const chatId = BigInt(ctx.chat.id);
  await db.update(pods).set({ telegramGroupChatId: chatId }).where(eq(pods.id, podId));
  await db.insert(auditLog).values({
    personId,
    action: 'telegram_pod_link',
    resourceType: 'pod',
    resourceId: podId,
    metadata: { chatId: chatId.toString() },
  });
  await ctx.reply('Group linked. This pod will now receive schedule summaries here.');
}

async function handlePodUnlink(ctx: Context): Promise<void> {
  const personId = await personIdForCtx(ctx);
  if (!personId || !ctx.chat) {
    await ctx.reply('Could not unlink: not recognised.');
    return;
  }
  const chatId = BigInt(ctx.chat.id);
  // Find the pod with this chat id; ensure caller is admin.
  const found = await db.select().from(pods).where(eq(pods.telegramGroupChatId, chatId)).limit(1);
  const pod = found[0];
  if (!pod) {
    await ctx.reply('This group is not linked to any pod.');
    return;
  }
  const memb = await db
    .select()
    .from(podMembers)
    .where(and(eq(podMembers.podId, pod.id), eq(podMembers.personId, personId)))
    .limit(1);
  if (!memb[0] || memb[0].role !== 'admin') {
    await ctx.reply('Only a pod admin can unlink this group.');
    return;
  }
  await db.update(pods).set({ telegramGroupChatId: null }).where(eq(pods.id, pod.id));
  await ctx.reply('Group unlinked.');
}

// ─── Inline keyboard helpers ───────────────────────────────────────────

export function buildProposalKeyboard(cycleId: string): { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } {
  const kb = new InlineKeyboard()
    .text('Accept All', `proposal:accept:${cycleId}`)
    .url('Open in App', `${config.frontendUrl}/schedule/cycles/${cycleId}`);
  // grammy InlineKeyboard.inline_keyboard is the raw structure.
  return { inline_keyboard: kb.inline_keyboard as unknown as { text: string; callback_data?: string; url?: string }[][] };
}
