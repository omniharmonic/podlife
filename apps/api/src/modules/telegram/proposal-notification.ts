/**
 * Proposal-time notification dispatcher (P7.2).
 *
 * Called from cycle.manager.ts after a cycle transitions to 'proposed'.
 * For each person in the cycle that has Telegram linked, builds a
 * personalized DM (only their partners' names — strictly nothing else)
 * with an inline Accept-All / Open-in-App keyboard.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  partnerships,
  persons,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { sendDmToPerson, type InlineKeyboard } from '../../services/notification/telegram.adapter.js';
import { config } from '../../lib/config.js';

interface ProposalLine {
  blockId: string;
  eventType: string;
  startTime: Date;
  endTime: Date;
  partnerName: string | null;
}

export async function sendProposalNotifications(cycleId: string): Promise<void> {
  const rows = await db
    .select()
    .from(schedulingCycles)
    .where(eq(schedulingCycles.id, cycleId))
    .limit(1);
  const cycle = rows[0];
  if (!cycle) return;

  const allPersons = await db
    .select()
    .from(persons)
    .where(inArray(persons.id, cycle.personIds));

  for (const me of allPersons) {
    if (!me.telegramChatId) continue;
    const channels = me.notificationChannels ?? [];
    if (!channels.includes('telegram')) continue;

    try {
      const text = await buildPersonalizedDm(cycle.id, me.id, cycle.horizonStart, cycle.horizonEnd, cycle.satisfactionReport, cycle.reviewWindowEnd);
      const keyboard = buildKeyboard(cycle.id);
      await sendDmToPerson(me.id, {
        text,
        replyMarkup: keyboard,
        cycleId: cycle.id,
      });
    } catch (err) {
      logger.warn('proposal notification failed', {
        personId: me.id,
        cycleId: cycle.id,
        err: (err as Error).message,
      });
    }
  }
}

async function buildPersonalizedDm(
  cycleId: string,
  personId: string,
  horizonStart: Date,
  horizonEnd: Date,
  satisfactionReport: unknown,
  reviewWindowEnd: Date | null,
): Promise<string> {
  // Per-partner satisfaction summary (only my own per-partner row, only my partners by id).
  const myReport = Array.isArray(satisfactionReport)
    ? (satisfactionReport as Array<{
        person_id: string;
        overall_pct: number;
        per_partner: Record<string, { pref_pct: number }>;
      }>).find((r) => r.person_id === personId)
    : undefined;

  // Resolve only this person's own partners' names.
  const myPartnerships = await db
    .select()
    .from(partnerships)
    .where(eq(partnerships.status, 'active'));
  const partnerNameById = new Map<string, string>();
  for (const p of myPartnerships) {
    if (p.personAId !== personId && p.personBId !== personId) continue;
    const otherId = p.personAId === personId ? p.personBId : p.personAId;
    const pr = await db.select().from(persons).where(eq(persons.id, otherId)).limit(1);
    if (pr[0]) partnerNameById.set(otherId, pr[0].displayName);
  }

  const partnerSummary = myReport?.per_partner
    ? Object.entries(myReport.per_partner)
        .filter(([id]) => partnerNameById.has(id))
        .map(([id, info]) => `${partnerNameById.get(id)}: ${Math.round(info.pref_pct ?? 0)}%`)
        .join(' • ')
    : '';

  // Their first 3-5 proposed blocks.
  const myBlocks = await loadMyProposedBlocks(personId, cycleId, partnerNameById);
  const blockLines = myBlocks.slice(0, 5).map((b) => formatBlockLine(b));

  const horizonLine = `${shortDate(horizonStart)} – ${shortDate(horizonEnd)}`;
  const reviewLine = reviewWindowEnd
    ? `Review window closes in ${hoursUntil(reviewWindowEnd)}h.`
    : '';

  const overall = myReport?.overall_pct != null ? `${Math.round(myReport.overall_pct)}%` : null;

  const lines: string[] = [];
  lines.push(`Hi ${(await displayNameFor(personId)) ?? 'there'} — Pod Life has proposed your schedule for ${horizonLine}.`);
  if (overall) lines.push(`Your overall satisfaction: ${overall}.`);
  if (partnerSummary) lines.push(partnerSummary);
  if (blockLines.length) {
    lines.push('');
    lines.push('Your blocks:');
    for (const b of blockLines) lines.push(b);
  }
  if (reviewLine) {
    lines.push('');
    lines.push(reviewLine);
  }
  lines.push('');
  lines.push(`Open: ${config.frontendUrl}/schedule/cycles/${cycleId}`);
  return lines.join('\n');
}

async function loadMyProposedBlocks(
  personId: string,
  cycleId: string,
  partnerNameById: Map<string, string>,
): Promise<ProposalLine[]> {
  const rows = await db
    .select({ tb: timeBlocks })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, personId),
        eq(timeBlocks.cycleId, cycleId),
        eq(timeBlocks.status, 'proposed'),
      ),
    );
  const out: ProposalLine[] = [];
  for (const { tb } of rows) {
    let partnerName: string | null = null;
    if (tb.partnershipId) {
      // Find the partnership and the other person.
      const pr = await db
        .select()
        .from(partnerships)
        .where(eq(partnerships.id, tb.partnershipId))
        .limit(1);
      const p = pr[0];
      if (p) {
        const otherId = p.personAId === personId ? p.personBId : p.personAId;
        partnerName = partnerNameById.get(otherId) ?? null;
      }
    }
    out.push({
      blockId: tb.id,
      eventType: tb.eventType,
      startTime: tb.startTime,
      endTime: tb.endTime,
      partnerName,
    });
  }
  out.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return out;
}

function buildKeyboard(cycleId: string): { inline_keyboard: InlineKeyboard } {
  return {
    inline_keyboard: [
      [
        { text: 'Accept All', callback_data: `proposal:accept:${cycleId}` },
        {
          text: 'Open in App',
          url: `${config.frontendUrl}/schedule/cycles/${cycleId}`,
        },
      ],
    ],
  };
}

async function displayNameFor(personId: string): Promise<string | null> {
  const rows = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  return rows[0]?.displayName ?? null;
}

function shortDate(d: Date): string {
  return d.toUTCString().slice(0, 11); // "Tue, 06 May"
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatBlockLine(b: ProposalLine): string {
  const day = shortDate(b.startTime);
  const t = `${pad(b.startTime.getUTCHours())}:${pad(b.startTime.getUTCMinutes())}`;
  const partner = b.partnerName ? ` with ${b.partnerName}` : '';
  return `• ${b.eventType}${partner} — ${day} ${t} UTC`;
}

function hoursUntil(d: Date): number {
  const ms = d.getTime() - Date.now();
  return Math.max(0, Math.round(ms / (60 * 60_000)));
}
