/**
 * Cycle manager — per arch § 8.4.
 *
 * Orchestrates the optimization flow:
 *   triggerCycle(personId, triggerType) → enqueue
 *   processCycle(jobData) → run by BullMQ worker:
 *      1. Resolve involved persons (partners + pod members of the trigger)
 *      2. Compute horizon
 *      3. Gather free windows for each
 *      4. Load partner preferences, pod gathering prefs, subgroup prefs
 *      5. Build OptimizationRequest, POST to /optimize
 *      6. Persist proposed time blocks + satisfaction report
 *      7. Notify participants
 */
import { and, eq, inArray, gte, lte, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type {
  OptimizationRequest,
  OptimizationResponse,
  OptimizerPartnerPreference,
  OptimizerEventType,
  OptimizerLockedBlock,
  OptimizerPersonSpec,
  OptimizerPodGatheringPref,
  OptimizerSubgroupPref,
  SubgroupConfig,
} from '@pod-life/shared';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { db } from '../../db/index.js';
import {
  eventTypes as eventTypesTable,
  partnerships,
  partnershipPreferences,
  podMembers,
  podPreferences,
  pods,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
  persons,
} from '../../db/schema.js';
import { getPersonFreeWindows } from '../../services/calendar/calendar.aggregator.js';
import { send as notify } from '../../services/notification/notification.service.js';
import { sendProposalNotifications } from '../telegram/proposal-notification.js';
import { queue } from '../../jobs/queue.js';
import { solve as solveInline } from '../../services/optimizer/index.js';
import { createHash } from 'node:crypto';

export interface TriggerInput {
  personId: string;
  triggerType: 'manual' | 'automatic' | 'reshuffle';
  podId?: string;
  horizonStart?: Date;
  horizonEnd?: Date;
}

export interface TriggerResult {
  cycleId: string;
}

export async function triggerCycle(input: TriggerInput): Promise<TriggerResult> {
  const involved = await getInvolvedPersonIds(input.personId, input.podId);
  const { start, end } = computeHorizon(input.horizonStart, input.horizonEnd);

  const [cycle] = await db
    .insert(schedulingCycles)
    .values({
      status: 'collecting',
      horizonStart: start,
      horizonEnd: end,
      triggeredBy: input.personId,
      triggerType: input.triggerType,
      personIds: involved,
    })
    .returning();
  if (!cycle) throw new Error('Failed to create cycle');

  await queue.enqueue('run-cycle', { cycleId: cycle.id }, { attempts: 3 });

  return { cycleId: cycle.id };
}

export async function getInvolvedPersonIds(
  personId: string,
  podId?: string,
): Promise<string[]> {
  const set = new Set<string>([personId]);

  // All active partners.
  const partners = await db
    .select()
    .from(partnerships)
    .where(
      and(
        or(eq(partnerships.personAId, personId), eq(partnerships.personBId, personId)),
        eq(partnerships.status, 'active'),
      ),
    );
  for (const p of partners) {
    set.add(p.personAId);
    set.add(p.personBId);
  }

  // If pod-scoped, add pod members; otherwise include all pods this person is in.
  const memberRows = await db
    .select()
    .from(podMembers)
    .where(and(eq(podMembers.personId, personId), isNotNull(podMembers.joinedAt)));
  const podIds = podId ? [podId] : memberRows.map((m) => m.podId);
  if (podIds.length > 0) {
    const allMembers = await db
      .select()
      .from(podMembers)
      .where(and(inArray(podMembers.podId, podIds), isNotNull(podMembers.joinedAt)));
    for (const m of allMembers) set.add(m.personId);
  }
  return Array.from(set);
}

export function computeHorizon(start?: Date, end?: Date): { start: Date; end: Date } {
  if (start && end) return { start, end };
  // Default: next 7 days starting tomorrow midnight UTC.
  const now = new Date();
  const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const e = new Date(s.getTime() + 7 * 24 * 60 * 60_000);
  return { start: s, end: e };
}

export async function processCycleJob(data: { cycleId: string }): Promise<unknown> {
  const cycleRows = await db
    .select()
    .from(schedulingCycles)
    .where(eq(schedulingCycles.id, data.cycleId))
    .limit(1);
  const cycle = cycleRows[0];
  if (!cycle) {
    logger.warn('cycle vanished before processing', { cycleId: data.cycleId });
    return { ok: false };
  }

  await db
    .update(schedulingCycles)
    .set({ status: 'optimizing' })
    .where(eq(schedulingCycles.id, cycle.id));

  try {
    // Build the OptimizationRequest.
    const personSpecs: OptimizerPersonSpec[] = [];
    const personRows = await db
      .select()
      .from(persons)
      .where(inArray(persons.id, cycle.personIds));
    for (const p of personRows) {
      const free = await getPersonFreeWindows(p.id, cycle.horizonStart, cycle.horizonEnd);
      // P9.3 timing-inference mitigation: when privacy_mode is on, add a
      // deterministic-per-cycle ±30min jitter to free-window edges. The
      // resulting windows are still inside the original windows (we shrink
      // never expand) so we don't propose times the user is unavailable.
      const jittered = p.privacyMode
        ? applyPrivacyJitter(free, p.id, cycle.id)
        : free;
      personSpecs.push({
        person_id: p.id,
        timezone: p.timezone,
        // Drop degenerate windows (start >= end). The aggregator's invert
        // step can emit a zero-length window at the horizon edge, which
        // trips Pydantic's "end must be after start" validator.
        free_windows: jittered
          .filter((w) => w.end.getTime() > w.start.getTime())
          .map((w) => ({
            start: w.start.toISOString(),
            end: w.end.toISOString(),
          })),
        solo_min_free_evenings: p.soloMinFreeEveningsPerWeek,
        solo_min_free_weekend_days: p.soloMinFreeWeekendDaysPerMonth,
      });
    }

    const partnerPrefs = await loadPartnerPreferences(cycle.personIds);
    const podGatherings = await loadPodGatheringPrefs(cycle.personIds);
    const subgroupPrefs = await loadSubgroupPrefs(cycle.personIds);
    const lockedBlocks = await loadLockedBlocks(cycle.id, cycle.horizonStart, cycle.horizonEnd);
    const types = await loadEventTypes();

    const req: OptimizationRequest = {
      horizon_start: cycle.horizonStart.toISOString(),
      horizon_end: cycle.horizonEnd.toISOString(),
      persons: personSpecs,
      partner_preferences: partnerPrefs,
      pod_gatherings: podGatherings,
      subgroup_prefs: subgroupPrefs,
      event_types: types,
      locked_blocks: lockedBlocks,
      slot_duration_minutes: 30,
    };

    // Optimizer transport selection:
    //   - Default: inline WASM solver (zero infra cost; no HTTP hop).
    //   - Opt-in HTTP: set OPTIMIZER_HTTP=1 to fall through to OPTIMIZER_URL,
    //     keeping the legacy Python service path available for debugging or
    //     parity comparisons. The OPTIMIZER_URL itself is no longer required.
    const useHttpOptimizer = process.env.OPTIMIZER_HTTP === '1';
    logger.info('calling optimizer', {
      cycleId: cycle.id,
      persons: personSpecs.length,
      transport: useHttpOptimizer ? `http:${config.optimizerUrl}` : 'inline-wasm',
    });

    let out: OptimizationResponse;
    if (useHttpOptimizer) {
      const res = await fetch(`${config.optimizerUrl}/optimize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        throw new Error(`Optimizer returned ${res.status}: ${await res.text()}`);
      }
      out = (await res.json()) as OptimizationResponse;
    } else {
      out = await solveInline(req);
    }

    // Persist proposed blocks and satisfaction report.
    await db.transaction(async (tx) => {
      for (const block of out.proposed_blocks) {
        const [tb] = await tx
          .insert(timeBlocks)
          .values({
            cycleId: cycle.id,
            eventType: block.event_type,
            startTime: new Date(block.start),
            endTime: new Date(block.end),
            status: 'proposed',
            sourcePodId: block.pod_id ?? null,
            partnershipId: block.partnership_id ?? null,
            satisfactionContribution: block.satisfaction_contribution,
          })
          .returning();
        if (!tb) continue;
        for (const pid of block.participant_ids) {
          await tx.insert(timeBlockParticipants).values({
            timeBlockId: tb.id,
            personId: pid,
            response: 'pending',
          });
        }
      }
      const reviewWindowMs = 48 * 60 * 60_000;
      await tx
        .update(schedulingCycles)
        .set({
          status: 'proposed',
          solverRunMs: out.solver_time_ms,
          satisfactionReport: out.satisfaction_scores,
          infeasibilityNotes: out.infeasibility_notes,
          reviewWindowStart: new Date(),
          reviewWindowEnd: new Date(Date.now() + reviewWindowMs),
        })
        .where(eq(schedulingCycles.id, cycle.id));
    });

    // Notify each person via in-app rows (always) and any opted-in channels.
    for (const pid of cycle.personIds) {
      await notify(pid, {
        title: 'New schedule proposed',
        body: 'Pod Life has new time-block proposals for your review.',
        actionUrl: `${config.frontendUrl}/schedule/cycles/${cycle.id}`,
        // Suppress the in-line Telegram dispatch from the generic notify(),
        // because we send richer per-person Telegram DMs below.
        channels: ['in_app'],
        cycleId: cycle.id,
      });
    }
    // Telegram-rich proposal DMs (best-effort).
    try {
      await sendProposalNotifications(cycle.id);
    } catch (err) {
      logger.warn('telegram proposal notifications failed', {
        cycleId: cycle.id,
        err: (err as Error).message,
      });
    }

    return { ok: true, cycleId: cycle.id };
  } catch (err) {
    logger.error('cycle failed', { cycleId: cycle.id, err: (err as Error).message });
    await db
      .update(schedulingCycles)
      .set({
        status: 'failed',
        infeasibilityNotes: [String((err as Error).message)],
      })
      .where(eq(schedulingCycles.id, cycle.id));
    throw err;
  }
}

/**
 * P9.3 — Privacy mode jitter. Shrinks each free window by a pseudo-random
 * amount up to 30 minutes on each edge, using a SHA-256 derived RNG seeded
 * with `(personId, cycleId)`. This is deterministic for a given cycle (so
 * the proposal is reproducible) but varies across cycles (so an observer
 * can't infer the underlying availability from week-to-week patterns).
 *
 * The jitter only ever shrinks the window; it never extends it past the
 * actual free time. Drops windows that become non-positive after jitter.
 */
export function applyPrivacyJitter(
  windows: Array<{ start: Date; end: Date }>,
  personId: string,
  cycleId: string,
): Array<{ start: Date; end: Date }> {
  const seed = createHash('sha256').update(`${personId}:${cycleId}`).digest();
  const out: Array<{ start: Date; end: Date }> = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    // Two independent jitter values from the seed: bytes (i*2, i*2+1).
    const startByte = seed[(i * 2) % seed.length] ?? 0;
    const endByte = seed[(i * 2 + 1) % seed.length] ?? 0;
    // 0..30 minutes of *forward* shift on the start, and *backward* on the end.
    const startShiftMin = Math.floor((startByte / 255) * 30);
    const endShiftMin = Math.floor((endByte / 255) * 30);
    const newStart = new Date(w.start.getTime() + startShiftMin * 60_000);
    const newEnd = new Date(w.end.getTime() - endShiftMin * 60_000);
    if (newEnd.getTime() - newStart.getTime() >= 30 * 60_000) {
      out.push({ start: newStart, end: newEnd });
    }
  }
  return out;
}

async function loadPartnerPreferences(
  personIds: string[],
): Promise<OptimizerPartnerPreference[]> {
  if (!personIds.length) return [];
  // Find all active partnerships among the involved persons.
  const ps = await db
    .select()
    .from(partnerships)
    .where(
      and(
        eq(partnerships.status, 'active'),
        inArray(partnerships.personAId, personIds),
        inArray(partnerships.personBId, personIds),
      ),
    );
  const out: OptimizerPartnerPreference[] = [];
  for (const p of ps) {
    const prefs = await db
      .select()
      .from(partnershipPreferences)
      .where(eq(partnershipPreferences.partnershipId, p.id));
    for (const pref of prefs) {
      const otherId = pref.personId === p.personAId ? p.personBId : p.personAId;
      out.push({
        partnership_id: p.id,
        partner_id: otherId,
        person_id: pref.personId,
        need_min_hours: Number(pref.needMinHours),
        need_min_date_nights: pref.needMinDateNights,
        need_min_overnights: pref.needMinOvernights,
        pref_ideal_hours: Number(pref.prefIdealHours),
        pref_date_nights: pref.prefDateNights,
        pref_overnights: pref.prefOvernights,
        pref_daytime_hangs: pref.prefDaytimeHangs,
        custom_prefs: (pref.customEventPrefs as OptimizerPartnerPreference['custom_prefs']) ?? [],
        recurring_holds:
          (pref.recurringHolds as OptimizerPartnerPreference['recurring_holds']) ?? [],
        preferred_windows:
          (pref.preferredWindows as OptimizerPartnerPreference['preferred_windows']) ?? [],
      });
    }
  }
  return out;
}

async function loadPodGatheringPrefs(personIds: string[]): Promise<OptimizerPodGatheringPref[]> {
  if (!personIds.length) return [];
  // Find pods that any of these persons belong to.
  const initialMemberRows = await db
    .select()
    .from(podMembers)
    .where(and(inArray(podMembers.personId, personIds), isNotNull(podMembers.joinedAt)));
  const podIds = Array.from(new Set(initialMemberRows.map((m) => m.podId)));
  if (!podIds.length) return [];

  // Now load ALL members of those pods — not just the persons in personIds.
  // Otherwise we'd send the optimizer a partial member list, which silently
  // excludes pod members from gathering candidates and trips the optimizer's
  // "≥2 members" validator if the triggerer is the only person in personIds.
  const allMembers = await db
    .select()
    .from(podMembers)
    .where(and(inArray(podMembers.podId, podIds), isNotNull(podMembers.joinedAt)));
  const podRows = await db.select().from(pods).where(inArray(pods.id, podIds));
  const prefRows = await db
    .select()
    .from(podPreferences)
    .where(inArray(podPreferences.podId, podIds));
  const prefByPod = new Map(prefRows.map((r) => [r.podId, r]));

  const out: OptimizerPodGatheringPref[] = [];
  for (const pod of podRows) {
    const memberIds = allMembers.filter((m) => m.podId === pod.id).map((m) => m.personId);
    if (memberIds.length < 2) continue; // single-member pods can't have gatherings
    const pref = prefByPod.get(pod.id);
    out.push({
      pod_id: pod.id,
      member_ids: memberIds,
      frequency: pref?.prefFullGatheringsPerCycle ?? 0,
      duration_hours: pref ? Number(pref.prefGatheringDurationHours) : 3,
      preferred_windows: [],
    });
  }
  return out;
}

async function loadSubgroupPrefs(personIds: string[]): Promise<OptimizerSubgroupPref[]> {
  if (!personIds.length) return [];
  const memberRows = await db
    .select()
    .from(podMembers)
    .where(and(inArray(podMembers.personId, personIds), isNotNull(podMembers.joinedAt)));
  const podIds = Array.from(new Set(memberRows.map((m) => m.podId)));
  if (!podIds.length) return [];
  const prefRows = await db
    .select()
    .from(podPreferences)
    .where(inArray(podPreferences.podId, podIds));
  const out: OptimizerSubgroupPref[] = [];
  for (const r of prefRows) {
    const cfg = (r.subgroupConfigs as SubgroupConfig[]) ?? [];
    for (const sg of cfg) {
      out.push({
        label: sg.label,
        member_ids: sg.memberIds,
        frequency: sg.frequencyPerCycle,
        duration_hours: sg.durationHours,
        preferred_windows: sg.preferredWindows ?? [],
      });
    }
  }
  return out;
}

async function loadLockedBlocks(
  cycleId: string,
  horizonStart: Date,
  horizonEnd: Date,
): Promise<OptimizerLockedBlock[]> {
  const rows = await db
    .select({
      id: timeBlocks.id,
      startTime: timeBlocks.startTime,
      endTime: timeBlocks.endTime,
    })
    .from(timeBlocks)
    .where(
      and(
        ne(timeBlocks.cycleId, cycleId),
        eq(timeBlocks.status, 'locked'),
        gte(timeBlocks.endTime, horizonStart),
        lte(timeBlocks.startTime, horizonEnd),
      ),
    );
  const out: OptimizerLockedBlock[] = [];
  for (const tb of rows) {
    const parts = await db
      .select({ personId: timeBlockParticipants.personId })
      .from(timeBlockParticipants)
      .where(eq(timeBlockParticipants.timeBlockId, tb.id));
    out.push({
      start: tb.startTime.toISOString(),
      end: tb.endTime.toISOString(),
      participant_ids: parts.map((p) => p.personId),
    });
  }
  void isNull;
  return out;
}

async function loadEventTypes(): Promise<OptimizerEventType[]> {
  const rows = await db.select().from(eventTypesTable).where(eq(eventTypesTable.isSystem, true));
  return rows.map((r) => ({
    label: r.label,
    duration_minutes: Math.round(Number(r.defaultDurationHours) * 60),
    blocks_next_morning: r.blocksNextMorning,
  }));
}
