/**
 * Polycule fixtures — direct port of apps/optimizer/tests/fixtures/polycule_configs.py.
 *
 * Each fixture builds an OptimizationRequest equivalent to the Python
 * version, anchored to the same fixed Monday 2026-05-11 00:00 UTC. Used by
 * the parity tests in fixtures.test.ts.
 */
import type {
  OptimizationRequest,
  OptimizerEventType,
  OptimizerPartnerPreference,
  OptimizerPersonSpec,
  OptimizerPodGatheringPref,
  OptimizerSubgroupPref,
  OptimizerLockedBlock,
} from '@pod-life/shared';

// Monday 2026-05-11 00:00 UTC.
export const HORIZON_START = new Date(Date.UTC(2026, 4, 11, 0, 0, 0));
export const HORIZON_DAYS_DEFAULT = 7;

export const DEFAULT_EVENT_TYPES: OptimizerEventType[] = [
  { label: 'Date Night', duration_minutes: 210, blocks_next_morning: false },
  { label: 'Overnight', duration_minutes: 720, blocks_next_morning: true },
  { label: 'Daytime Hang', duration_minutes: 150, blocks_next_morning: false },
  { label: 'Pod Gathering', duration_minutes: 210, blocks_next_morning: false },
  { label: 'Sub-group Hang', duration_minutes: 150, blocks_next_morning: false },
];

function horizonEnd(days = HORIZON_DAYS_DEFAULT): Date {
  return new Date(HORIZON_START.getTime() + days * 24 * 60 * 60 * 1000);
}

/** One UTC evening window (18:00–23:00) per day, for `days` consecutive days. */
export function eveningWindows(days: number, startHour = 18, endHour = 23) {
  const out: Array<{ start: string; end: string }> = [];
  for (let d = 0; d < days; d++) {
    const dayStart = new Date(HORIZON_START.getTime() + d * 24 * 60 * 60 * 1000);
    const start = new Date(dayStart);
    start.setUTCHours(startHour, 0, 0, 0);
    const end = new Date(dayStart);
    end.setUTCHours(endHour, 0, 0, 0);
    out.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return out;
}

/** First `nEvenings` evenings only — equivalent to Python's limited_windows. */
export function limitedWindows(nEvenings: number) {
  return eveningWindows(nEvenings);
}

interface PartialConfig {
  persons: Array<Partial<OptimizerPersonSpec> & { person_id: string }>;
  partner_preferences: Array<Partial<OptimizerPartnerPreference> & {
    person_id: string;
    partner_id: string;
  }>;
  pod_gatherings?: OptimizerPodGatheringPref[];
  subgroup_prefs?: OptimizerSubgroupPref[];
  event_types?: OptimizerEventType[];
  locked_blocks?: OptimizerLockedBlock[];
  horizon_days?: number;
}

function fillPref(
  p: Partial<OptimizerPartnerPreference> & { person_id: string; partner_id: string },
): OptimizerPartnerPreference {
  return {
    partnership_id: p.partnership_id ?? null,
    partner_id: p.partner_id,
    person_id: p.person_id,
    need_min_hours: p.need_min_hours ?? 0,
    need_min_date_nights: p.need_min_date_nights ?? 0,
    need_min_overnights: p.need_min_overnights ?? 0,
    pref_ideal_hours: p.pref_ideal_hours ?? 0,
    pref_date_nights: p.pref_date_nights ?? 0,
    pref_overnights: p.pref_overnights ?? 0,
    pref_daytime_hangs: p.pref_daytime_hangs ?? 0,
    custom_prefs: p.custom_prefs ?? [],
    recurring_holds: p.recurring_holds ?? [],
    preferred_windows: p.preferred_windows ?? [],
  };
}

function fillPersonSpec(p: Partial<OptimizerPersonSpec> & { person_id: string }): OptimizerPersonSpec {
  return {
    person_id: p.person_id,
    timezone: p.timezone ?? 'America/Denver',
    free_windows: p.free_windows ?? [],
    solo_min_free_evenings: p.solo_min_free_evenings ?? 0,
    solo_min_free_weekend_days: p.solo_min_free_weekend_days ?? 0,
  };
}

function wrap(cfg: PartialConfig): OptimizationRequest {
  return {
    horizon_start: HORIZON_START.toISOString(),
    horizon_end: horizonEnd(cfg.horizon_days ?? HORIZON_DAYS_DEFAULT).toISOString(),
    persons: cfg.persons.map(fillPersonSpec),
    partner_preferences: cfg.partner_preferences.map(fillPref),
    pod_gatherings: cfg.pod_gatherings ?? [],
    subgroup_prefs: cfg.subgroup_prefs ?? [],
    event_types: cfg.event_types ?? DEFAULT_EVENT_TYPES,
    locked_blocks: cfg.locked_blocks ?? [],
    slot_duration_minutes: 30,
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────

export function triadBasic(): OptimizationRequest {
  return wrap({
    persons: [
      { person_id: 'A', timezone: 'America/Denver', free_windows: eveningWindows(7) },
      { person_id: 'B', timezone: 'America/Denver', free_windows: eveningWindows(7) },
      { person_id: 'C', timezone: 'America/Denver', free_windows: eveningWindows(7) },
    ],
    partner_preferences: [
      { person_id: 'A', partner_id: 'B', pref_ideal_hours: 6, pref_date_nights: 2 },
      { person_id: 'A', partner_id: 'C', pref_ideal_hours: 6, pref_date_nights: 2 },
      { person_id: 'B', partner_id: 'A', pref_ideal_hours: 6, pref_date_nights: 2 },
      { person_id: 'B', partner_id: 'C', pref_ideal_hours: 4, pref_date_nights: 1 },
      { person_id: 'C', partner_id: 'A', pref_ideal_hours: 6, pref_date_nights: 2 },
      { person_id: 'C', partner_id: 'B', pref_ideal_hours: 4, pref_date_nights: 1 },
    ],
    pod_gatherings: [
      {
        pod_id: 'pod1',
        member_ids: ['A', 'B', 'C'],
        frequency: 1,
        duration_hours: 3,
        preferred_windows: [],
      },
    ],
  });
}

export function vStructure(): OptimizationRequest {
  return wrap({
    persons: [
      { person_id: 'A', timezone: 'America/Denver', free_windows: eveningWindows(7) },
      { person_id: 'B', timezone: 'America/Denver', free_windows: eveningWindows(7) },
      { person_id: 'C', timezone: 'America/Denver', free_windows: eveningWindows(7) },
    ],
    partner_preferences: [
      { person_id: 'A', partner_id: 'B', pref_ideal_hours: 8, need_min_hours: 4, pref_date_nights: 2 },
      { person_id: 'A', partner_id: 'C', pref_ideal_hours: 8, need_min_hours: 4, pref_date_nights: 2 },
      { person_id: 'B', partner_id: 'A', pref_ideal_hours: 10, need_min_hours: 6, pref_date_nights: 3 },
      { person_id: 'C', partner_id: 'A', pref_ideal_hours: 6, need_min_hours: 3, pref_date_nights: 1 },
    ],
  });
}

export function multiPodConflict(): OptimizationRequest {
  return wrap({
    persons: [
      { person_id: 'A', timezone: 'America/Denver', free_windows: limitedWindows(4) },
      { person_id: 'B', timezone: 'America/Denver', free_windows: eveningWindows(7) },
      { person_id: 'C', timezone: 'America/Denver', free_windows: eveningWindows(7) },
    ],
    partner_preferences: [
      { person_id: 'A', partner_id: 'B', pref_ideal_hours: 8, need_min_hours: 3 },
      { person_id: 'A', partner_id: 'C', pref_ideal_hours: 8, need_min_hours: 3 },
      { person_id: 'B', partner_id: 'A', pref_ideal_hours: 10, need_min_hours: 5 },
      { person_id: 'C', partner_id: 'A', pref_ideal_hours: 10, need_min_hours: 5 },
    ],
  });
}

export function oversubscribed(): OptimizationRequest {
  const persons: OptimizerPersonSpec[] = [
    fillPersonSpec({ person_id: 'A', free_windows: eveningWindows(7) }),
  ];
  for (let i = 1; i <= 4; i++) {
    persons.push(fillPersonSpec({ person_id: `P${i}`, free_windows: eveningWindows(7) }));
  }
  const prefs: OptimizerPartnerPreference[] = [];
  for (let i = 1; i <= 4; i++) {
    prefs.push(
      fillPref({ person_id: 'A', partner_id: `P${i}`, pref_ideal_hours: 8, need_min_hours: 2 }),
    );
    prefs.push(
      fillPref({ person_id: `P${i}`, partner_id: 'A', pref_ideal_hours: 8, need_min_hours: 2 }),
    );
  }
  return wrap({ persons, partner_preferences: prefs });
}

export function noOverlapPair(): OptimizationRequest {
  // A free 8–12 UTC, B free 18–22 UTC. No overlap.
  const a = new Date(HORIZON_START);
  a.setUTCHours(8, 0, 0, 0);
  const aEnd = new Date(HORIZON_START);
  aEnd.setUTCHours(12, 0, 0, 0);
  const b = new Date(HORIZON_START);
  b.setUTCHours(18, 0, 0, 0);
  const bEnd = new Date(HORIZON_START);
  bEnd.setUTCHours(22, 0, 0, 0);
  return wrap({
    persons: [
      {
        person_id: 'A',
        timezone: 'UTC',
        free_windows: [{ start: a.toISOString(), end: aEnd.toISOString() }],
      },
      {
        person_id: 'B',
        timezone: 'UTC',
        free_windows: [{ start: b.toISOString(), end: bEnd.toISOString() }],
      },
    ],
    partner_preferences: [{ person_id: 'A', partner_id: 'B', pref_ideal_hours: 4 }],
    event_types: [{ label: 'Date Night', duration_minutes: 180, blocks_next_morning: false }],
  });
}

export function tenPersonsFiveCouples(): OptimizationRequest {
  const personIds = Array.from({ length: 10 }, (_, i) => `X${i}`);
  const persons: OptimizerPersonSpec[] = personIds.map((pid) =>
    fillPersonSpec({ person_id: pid, timezone: 'UTC', free_windows: eveningWindows(7) }),
  );
  const prefs: OptimizerPartnerPreference[] = [];
  for (let i = 0; i < 10; i += 2) {
    const a = personIds[i]!;
    const b = personIds[i + 1]!;
    prefs.push(
      fillPref({ person_id: a, partner_id: b, pref_ideal_hours: 6, need_min_hours: 2 }),
    );
    prefs.push(
      fillPref({ person_id: b, partner_id: a, pref_ideal_hours: 6, need_min_hours: 2 }),
    );
  }
  return wrap({
    persons,
    partner_preferences: prefs,
    event_types: [
      { label: 'Date Night', duration_minutes: 210, blocks_next_morning: false },
      { label: 'Daytime Hang', duration_minutes: 150, blocks_next_morning: false },
    ],
  });
}
