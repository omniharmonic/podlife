/**
 * Pod-group chat notifications (P7.3).
 *
 * Helpers to format messages for the linked Telegram group chat of a pod.
 * Privacy: messages reference ONLY members of THIS pod, never any other.
 * The privacy filter (group) re-validates this at send time.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  pods,
  podMembers,
  persons,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../../db/schema.js';
import { notifyPodGroup } from '../../services/notification/telegram.adapter.js';
import { logger } from '../../lib/logger.js';

export async function sendLockedScheduleSummary(podId: string, cycleId: string): Promise<void> {
  const podRows = await db.select().from(pods).where(eq(pods.id, podId)).limit(1);
  const pod = podRows[0];
  if (!pod) return;
  if (!pod.telegramGroupChatId) return;

  const memberRows = await db
    .select()
    .from(podMembers)
    .where(and(eq(podMembers.podId, podId), isNotNull(podMembers.joinedAt)));
  const memberIds = new Set(memberRows.map((m) => m.personId));
  if (memberIds.size === 0) return;

  const personRows = memberIds.size
    ? await db.select().from(persons).where(inArray(persons.id, Array.from(memberIds)))
    : [];
  const nameById = new Map(personRows.map((p) => [p.id, p.displayName]));

  const cycleRows = await db
    .select()
    .from(schedulingCycles)
    .where(eq(schedulingCycles.id, cycleId))
    .limit(1);
  const cycle = cycleRows[0];
  if (!cycle) return;

  // Load locked blocks for this cycle that involve this pod's members only.
  const blocks = await db
    .select()
    .from(timeBlocks)
    .where(
      and(
        eq(timeBlocks.cycleId, cycleId),
        inArray(timeBlocks.status, ['locked', 'accepted'] as const),
      ),
    );

  const lines: string[] = [];
  lines.push(`🏠 ${pod.name}'s schedule for ${shortDate(cycle.horizonStart)} – ${shortDate(cycle.horizonEnd)}:`);

  for (const b of blocks) {
    const parts = await db
      .select({ personId: timeBlockParticipants.personId })
      .from(timeBlockParticipants)
      .where(eq(timeBlockParticipants.timeBlockId, b.id));
    // Privacy: drop blocks that include any non-pod-member.
    if (!parts.every((p) => memberIds.has(p.personId))) continue;
    const names = parts.map((p) => nameById.get(p.personId) ?? '').filter(Boolean);
    if (names.length === 0) continue;
    lines.push(
      `• ${b.eventType} — ${shortDate(b.startTime)} ${pad(b.startTime.getUTCHours())}:${pad(b.startTime.getUTCMinutes())} UTC — ${names.join(' & ')}`,
    );
  }

  if (lines.length === 1) {
    lines.push('(no full-pod blocks scheduled this cycle)');
  }

  const result = await notifyPodGroup(podId, { text: lines.join('\n') });
  if (!result.delivered) {
    logger.warn('pod group locked summary not delivered', {
      podId,
      cycleId,
      reason: result.reason,
    });
  }
}

export async function sendReshuffleNotice(
  podId: string,
  reshufflerPersonId: string,
  newStart: Date,
  dayLabel: string,
): Promise<void> {
  const podRows = await db.select().from(pods).where(eq(pods.id, podId)).limit(1);
  const pod = podRows[0];
  if (!pod || !pod.telegramGroupChatId) return;

  // Verify the reshuffler is a pod member (and use their display name only
  // if so; otherwise abort the notice — privacy guard).
  const memb = await db
    .select()
    .from(podMembers)
    .where(
      and(
        eq(podMembers.podId, podId),
        eq(podMembers.personId, reshufflerPersonId),
        isNotNull(podMembers.joinedAt),
      ),
    )
    .limit(1);
  if (!memb[0]) return;

  const personRows = await db
    .select()
    .from(persons)
    .where(eq(persons.id, reshufflerPersonId))
    .limit(1);
  const name = personRows[0]?.displayName ?? 'A pod member';

  const text = `${name} reshuffled ${dayLabel} — new time: ${shortDate(newStart)} ${pad(newStart.getUTCHours())}:${pad(newStart.getUTCMinutes())} UTC.`;
  await notifyPodGroup(podId, { text });
}

function shortDate(d: Date): string {
  return d.toUTCString().slice(0, 11);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
