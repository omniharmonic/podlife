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

/**
 * Time-of-day windows per event type, expressed as the LOCAL start hour of
 * the first participant. Stops the optimizer from proposing a Date Night at
 * 11am or a Daytime Hang at midnight just because the calendars happen to
 * overlap there.
 *
 * Ranges are inclusive-start, exclusive-end (so [17, 22] = 17:00–21:59 start
 * times). Event types not in the map have no time-of-day constraint —
 * Pod Gatherings and Sub-group Hangs can land anywhere all participants
 * are free.
 */
const EVENT_TIME_OF_DAY_LOCAL: Record<string, [number, number]> = {
  'Date Night': [17, 22], // 5pm – just before 10pm start
  Overnight: [18, 23], // 6pm – just before 11pm start
  'Daytime Hang': [9, 16], // 9am – just before 4pm start
};

/** Hour-of-day in the given IANA timezone for a UTC instant. 0–23. */
function localHour(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const part = parts.find((p) => p.type === 'hour')?.value;
  if (!part) return 0;
  const n = parseInt(part, 10);
  // Intl emits "24" for midnight in some zones; normalize.
  return Number.isFinite(n) ? n % 24 : 0;
}

function isStartHourValid(
  eventLabel: string,
  startTime: Date,
  participantTz: string,
): boolean {
  const range = EVENT_TIME_OF_DAY_LOCAL[eventLabel];
  if (!range) return true;
  const hour = localHour(startTime, participantTz);
  return hour >= range[0] && hour < range[1];
}

/** Generate all candidate slots for the given prepared request. */
export function discoverCandidateSlots(prepared: PreparedRequest): CandidateSlot[] {
  const { raw, horizonStart, horizonSlots, slotMinutes } = prepared;
  const candidates: CandidateSlot[] = [];

  const tzByPersonId = new Map<string, string>();
  for (const p of raw.persons) tzByPersonId.set(p.person_id, p.timezone);

  /** Convert a slot index back to a UTC Date for tz comparisons. */
  const slotToDate = (slot: number): Date =>
    new Date(horizonStart.getTime() + slot * slotMinutes * 60_000);

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

    // Use the first participant's timezone for time-of-day filtering. For
    // mixed-tz pairs this is a heuristic — the right thing long-term is to
    // check the intersection of both partners' allowable windows.
    const tzForPair = tzByPersonId.get(pairIds[0]!) ?? 'UTC';

    for (const [runStart, runEnd] of runs) {
      const runLength = runEnd - runStart;
      for (const et of raw.event_types) {
        // Pod Gathering / Sub-group are not 2-person events.
        if (et.label === 'Pod Gathering' || et.label === 'Sub-group Hang') continue;
        const slotsNeeded = Math.trunc(et.duration_minutes / slotMinutes);
        if (slotsNeeded <= 0 || runLength < slotsNeeded) continue;
        for (let offset = 0; offset <= runLength - slotsNeeded; offset++) {
          const startTime = slotToDate(runStart + offset);
          if (!isStartHourValid(et.label, startTime, tzForPair)) continue;
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
