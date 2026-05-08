/**
 * Pod relational-health metrics — read-only, computed on demand.
 *
 * Privacy boundary (CLAUDE.md § Privacy Model): the response includes ONLY
 * data scoped to this pod. A member's partnerships outside the pod are
 * intentionally invisible. We compute by:
 *
 *   1. Find the most recent `scheduling_cycles` row whose `person_ids`
 *      include AT LEAST ONE pod member. (Pragmatic choice: ensures we
 *      surface the most recent cycle relevant to the pod even when the
 *      cycle was triggered by a partial subset.)
 *   2. For each pod member, sum `pref_ideal_hours` across partnerships
 *      where BOTH parties are pod members (in-pod partnerships only).
 *   3. Sum `time_blocks` hours where the participant set ⊆ pod members.
 *   4. Generate warm, factual `observations` strings.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  partnerships,
  partnershipPreferences,
  podMembers,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
  persons,
} from '../../db/schema.js';

export interface PodHealthMember {
  personId: string;
  displayName: string;
  avatarUrl: string | null;
  weeklyHoursWanted: number;
  weeklyHoursScheduled: number;
  satisfactionPct: number;
  needMinDateNights: number;
  scheduledDateNights: number;
}

export interface PodHealthResponse {
  podSatisfactionPct: number;
  members: PodHealthMember[];
  observations: string[];
  lastCycleAt: string | null;
}

export async function getPodHealth(podId: string): Promise<PodHealthResponse> {
  // 1. Pod member list with display names.
  const memberRows = await db
    .select({
      personId: podMembers.personId,
      displayName: persons.displayName,
      avatarUrl: persons.avatarUrl,
    })
    .from(podMembers)
    .innerJoin(persons, eq(persons.id, podMembers.personId))
    .where(eq(podMembers.podId, podId));

  const memberIds = memberRows.map((m) => m.personId);
  const memberSet = new Set(memberIds);
  if (memberIds.length === 0) {
    return { podSatisfactionPct: 0, members: [], observations: [], lastCycleAt: null };
  }

  // 2. In-pod partnerships only (both parties are pod members).
  const inPodPartnerships = memberIds.length >= 2
    ? await db
        .select()
        .from(partnerships)
        .where(
          and(
            inArray(partnerships.personAId, memberIds),
            inArray(partnerships.personBId, memberIds),
          ),
        )
    : [];
  const inPodPartnershipIds = inPodPartnerships.map((p) => p.id);

  // 3. Pull preferences for these in-pod partnerships only. Note: this
  // intentionally EXCLUDES preferences for any partnerships involving
  // people outside this pod, even when the pref row belongs to a pod
  // member. That's the privacy invariant for this endpoint.
  const prefs = inPodPartnershipIds.length > 0
    ? await db
        .select()
        .from(partnershipPreferences)
        .where(inArray(partnershipPreferences.partnershipId, inPodPartnershipIds))
    : [];

  // weeklyHoursWanted is the sum across this person's IN-POD partnerships.
  const wantedByPerson = new Map<string, number>();
  const minDateNightsByPerson = new Map<string, number>();
  for (const pref of prefs) {
    if (!memberSet.has(pref.personId)) continue;
    const cur = wantedByPerson.get(pref.personId) ?? 0;
    wantedByPerson.set(pref.personId, cur + Number(pref.prefIdealHours));
    const dn = minDateNightsByPerson.get(pref.personId) ?? 0;
    minDateNightsByPerson.set(pref.personId, dn + pref.needMinDateNights);
  }

  // 4. Find the most recent scheduling cycle that touches at least one pod
  // member. We then filter the cycle's time_blocks to those whose
  // participant set is a subset of the pod members.
  const recentCycles = await db
    .select()
    .from(schedulingCycles)
    .orderBy(desc(schedulingCycles.createdAt))
    .limit(20);
  const cycle = recentCycles.find((c) =>
    (c.personIds as string[]).some((pid) => memberSet.has(pid)),
  );

  let scheduledHoursByPerson = new Map<string, number>();
  let scheduledDateNightsByPerson = new Map<string, number>();
  let lastCycleAt: string | null = null;

  if (cycle) {
    lastCycleAt = cycle.createdAt.toISOString();
    const blocks = await db
      .select()
      .from(timeBlocks)
      .where(eq(timeBlocks.cycleId, cycle.id));
    const blockIds = blocks.map((b) => b.id);
    const parts = blockIds.length
      ? await db
          .select()
          .from(timeBlockParticipants)
          .where(inArray(timeBlockParticipants.timeBlockId, blockIds))
      : [];
    const partsByBlock = new Map<string, string[]>();
    for (const p of parts) {
      const arr = partsByBlock.get(p.timeBlockId) ?? [];
      arr.push(p.personId);
      partsByBlock.set(p.timeBlockId, arr);
    }
    for (const b of blocks) {
      const participants = partsByBlock.get(b.id) ?? [];
      // Privacy: only count blocks whose participants are ALL pod members.
      // A block that touches a non-pod participant belongs to a different
      // pod/scope and must not appear in this pod's health metrics.
      if (participants.length === 0) continue;
      const allInPod = participants.every((pid) => memberSet.has(pid));
      if (!allInPod) continue;
      const hours = (b.endTime.getTime() - b.startTime.getTime()) / 3_600_000;
      // Match common spellings: "Date Night" (default seed), "date_night",
      // "date-night", etc. — case- and separator-insensitive.
      const normalizedType = b.eventType.toLowerCase().replace(/[\s_-]+/g, '');
      const isDateNight = normalizedType === 'datenight';
      for (const pid of participants) {
        scheduledHoursByPerson.set(pid, (scheduledHoursByPerson.get(pid) ?? 0) + hours);
        if (isDateNight) {
          scheduledDateNightsByPerson.set(
            pid,
            (scheduledDateNightsByPerson.get(pid) ?? 0) + 1,
          );
        }
      }
    }
  }

  // 5. Compose member rows and observations.
  const members: PodHealthMember[] = memberRows.map((m) => {
    const wanted = round1(wantedByPerson.get(m.personId) ?? 0);
    const scheduled = round1(scheduledHoursByPerson.get(m.personId) ?? 0);
    const satisfactionPct = wanted > 0 ? clamp01(scheduled / wanted) : 1;
    return {
      personId: m.personId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      weeklyHoursWanted: wanted,
      weeklyHoursScheduled: scheduled,
      satisfactionPct: round2(satisfactionPct),
      needMinDateNights: minDateNightsByPerson.get(m.personId) ?? 0,
      scheduledDateNights: scheduledDateNightsByPerson.get(m.personId) ?? 0,
    };
  });

  const podSatisfactionPct = members.length
    ? round2(members.reduce((s, m) => s + m.satisfactionPct, 0) / members.length)
    : 0;

  const observations = buildObservations(members);

  return { podSatisfactionPct, members, observations, lastCycleAt };
}

function buildObservations(members: PodHealthMember[]): string[] {
  const out: string[] = [];
  for (const m of members) {
    if (m.weeklyHoursWanted === 0) continue;
    const pct = Math.round(m.satisfactionPct * 100);
    if (pct < 90 && pct >= 50) {
      out.push(
        `${m.displayName} is at ${pct}% of the time they hope for this cycle.`,
      );
    } else if (pct < 50) {
      out.push(
        `${m.displayName}'s time is well below what they'd like — only ${pct}% of their hopes are met this cycle.`,
      );
    } else if (pct >= 95) {
      out.push(`${m.displayName} is getting close to all the time they hope for. Lovely.`);
    }
    if (m.needMinDateNights > 0 && m.scheduledDateNights < m.needMinDateNights) {
      out.push(
        `${m.displayName}'s date-night minimum (${m.needMinDateNights}) isn't met yet — ${m.scheduledDateNights} scheduled.`,
      );
    }
  }
  return out;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
