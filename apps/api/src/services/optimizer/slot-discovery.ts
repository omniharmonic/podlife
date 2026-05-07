/**
 * Candidate-slot discovery.
 *
 * Direct port of apps/optimizer/src/slot_discovery.py — see that file's
 * header for the algorithm. Behavior must remain identical so the inline
 * solver matches the reference Python implementation.
 *
 * For every partner pair, pod gathering, and subgroup, compute the
 * windows in which all participants are simultaneously free, then
 * enumerate candidate blocks of each admissible event-type duration.
 * Locked blocks are subtracted from each person's free slots before
 * intersection.
 */
import type { CandidateSlot, PreparedRequest } from './types.js';
import { participantKeyOf } from './types.js';

/** Generate all candidate slots for the given prepared request. */
export function discoverCandidateSlots(prepared: PreparedRequest): CandidateSlot[] {
  const { raw, horizonStart, horizonSlots, slotMinutes } = prepared;
  const candidates: CandidateSlot[] = [];

  // ── 1. Per-person free slot sets ────────────────────────────────────
  const personFree = new Map<string, Set<number>>();
  for (const person of raw.persons) {
    const free = new Set<number>();
    for (const window of person.free_windows) {
      const wStart = new Date(window.start).getTime();
      const wEnd = new Date(window.end).getTime();
      const startSlot = Math.trunc((wStart - horizonStart.getTime()) / 60_000 / slotMinutes);
      const endSlot = Math.trunc((wEnd - horizonStart.getTime()) / 60_000 / slotMinutes);
      const lo = Math.max(0, startSlot);
      const hi = Math.min(horizonSlots, endSlot);
      for (let s = lo; s < hi; s++) free.add(s);
    }
    personFree.set(person.person_id, free);
  }

  // ── 2. Subtract locked blocks ───────────────────────────────────────
  for (const locked of raw.locked_blocks) {
    const lStart = new Date(locked.start).getTime();
    const lEnd = new Date(locked.end).getTime();
    const lockStart = Math.trunc((lStart - horizonStart.getTime()) / 60_000 / slotMinutes);
    const lockEnd = Math.trunc((lEnd - horizonStart.getTime()) / 60_000 / slotMinutes);
    for (const pid of locked.participant_ids) {
      const free = personFree.get(pid);
      if (!free) continue;
      for (let s = lockStart; s < lockEnd; s++) free.delete(s);
    }
  }

  const allFreeFor = (ids: string[]): Set<number> | null => {
    const sets = ids.map((id) => personFree.get(id));
    if (sets.some((s) => !s)) return null;
    const [first, ...rest] = sets as Set<number>[];
    if (!first) return null;
    const out = new Set<number>();
    outer: for (const s of first) {
      for (const r of rest) {
        if (!r.has(s)) continue outer;
      }
      out.add(s);
    }
    return out;
  };

  // ── 3a. Pair candidates (partner relationships) ────────────────────
  const seenPairs = new Set<string>();
  for (const pref of raw.partner_preferences) {
    const pairIds = [pref.person_id, pref.partner_id];
    const pairKey = participantKeyOf(pairIds);
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const sharedFree = allFreeFor(pairIds);
    if (!sharedFree || sharedFree.size === 0) continue;

    const runs = findContiguousRuns([...sharedFree].sort((a, b) => a - b));
    const partnershipId = pref.partnership_id ?? null;

    for (const [runStart, runEnd] of runs) {
      const runLength = runEnd - runStart;
      for (const et of raw.event_types) {
        // Pod Gathering / Sub-group are not 2-person events.
        if (et.label === 'Pod Gathering' || et.label === 'Sub-group Hang') continue;
        const slotsNeeded = Math.trunc(et.duration_minutes / slotMinutes);
        if (slotsNeeded <= 0 || runLength < slotsNeeded) continue;
        for (let offset = 0; offset <= runLength - slotsNeeded; offset++) {
          candidates.push({
            startSlot: runStart + offset,
            endSlot: runStart + offset + slotsNeeded,
            durationHours: et.duration_minutes / 60,
            participantIds: pairIds,
            participantKey: pairKey,
            eventType: et.label,
            partnershipId,
            podId: null,
          });
        }
      }
    }
  }

  // ── 3b. Pod gathering candidates ───────────────────────────────────
  for (const pod of raw.pod_gatherings) {
    const memberIds = pod.member_ids;
    const podKey = participantKeyOf(memberIds);
    const shared = allFreeFor(memberIds);
    if (!shared || shared.size === 0) continue;

    const runs = findContiguousRuns([...shared].sort((a, b) => a - b));
    const slotsNeeded = Math.trunc((pod.duration_hours * 60) / slotMinutes);
    if (slotsNeeded <= 0) continue;

    for (const [runStart, runEnd] of runs) {
      const runLength = runEnd - runStart;
      if (runLength < slotsNeeded) continue;
      for (let offset = 0; offset <= runLength - slotsNeeded; offset++) {
        candidates.push({
          startSlot: runStart + offset,
          endSlot: runStart + offset + slotsNeeded,
          durationHours: pod.duration_hours,
          participantIds: [...memberIds],
          participantKey: podKey,
          eventType: 'Pod Gathering',
          partnershipId: null,
          podId: pod.pod_id,
        });
      }
    }
  }

  // ── 3c. Subgroup candidates ────────────────────────────────────────
  for (const sub of raw.subgroup_prefs) {
    const memberIds = sub.member_ids;
    const subKey = participantKeyOf(memberIds);
    const shared = allFreeFor(memberIds);
    if (!shared || shared.size === 0) continue;

    const runs = findContiguousRuns([...shared].sort((a, b) => a - b));
    const slotsNeeded = Math.trunc((sub.duration_hours * 60) / slotMinutes);
    if (slotsNeeded <= 0) continue;

    for (const [runStart, runEnd] of runs) {
      const runLength = runEnd - runStart;
      if (runLength < slotsNeeded) continue;
      for (let offset = 0; offset <= runLength - slotsNeeded; offset++) {
        candidates.push({
          startSlot: runStart + offset,
          endSlot: runStart + offset + slotsNeeded,
          durationHours: sub.duration_hours,
          participantIds: [...memberIds],
          participantKey: subKey,
          eventType: 'Sub-group Hang',
          partnershipId: null,
          podId: null,
        });
      }
    }
  }

  return candidates;
}

/**
 * Collapse a sorted list of slot indices into [start, endExclusive] runs.
 * Mirrors apps/optimizer/src/slot_discovery.py:_find_contiguous_runs.
 */
export function findContiguousRuns(sortedSlots: number[]): Array<[number, number]> {
  if (sortedSlots.length === 0) return [];

  const runs: Array<[number, number]> = [];
  let runStart = sortedSlots[0]!;
  let prev = sortedSlots[0]!;

  for (let i = 1; i < sortedSlots.length; i++) {
    const slot = sortedSlots[i]!;
    if (slot !== prev + 1) {
      runs.push([runStart, prev + 1]);
      runStart = slot;
    }
    prev = slot;
  }
  runs.push([runStart, prev + 1]);
  return runs;
}
