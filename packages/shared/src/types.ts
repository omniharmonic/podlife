// Domain types shared across api / web. Keep narrow and stable;
// add to validation.ts (Zod) for runtime-checked types.

import type {
  PartnershipStatus,
  SchedulingCadence,
  CalendarProviderName,
  TimeBlockStatus,
  ParticipantResponse,
  CycleStatus,
  PodRole,
  NotificationChannel,
} from './enums';

export interface Person {
  id: string;
  displayName: string;
  email: string;
  timezone: string;
  telegramHandle: string | null;
  avatarUrl: string | null;
  soloMinFreeEveningsPerWeek: number;
  soloMinFreeWeekendDaysPerMonth: number;
  notificationChannels: NotificationChannel[];
  /** Phase 9: opt-in scheduling jitter (timing-inference mitigation). */
  privacyMode: boolean;
  onboardedAt: string | null;
  createdAt: string;
}

export interface Partnership {
  id: string;
  personAId: string;
  personBId: string;
  status: PartnershipStatus;
  invitedBy: string;
  colorA: string;
  colorB: string;
  createdAt: string;
}

export interface PartnershipPreference {
  id: string;
  partnershipId: string;
  personId: string;
  cadence: SchedulingCadence;
  needMinHours: number;
  needMinDateNights: number;
  needMinOvernights: number;
  prefIdealHours: number;
  prefDateNights: number;
  prefOvernights: number;
  prefDaytimeHangs: number;
  customEventPrefs: CustomEventPref[];
  recurringHolds: RecurringHold[];
  preferredWindows: WindowSpec[];
}

export interface CustomEventPref {
  label: string;
  durationHours: number;
  prefCount: number;
}

export interface RecurringHold {
  dayOfWeek: number; // 0=Sunday
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  eventType: string;
  label?: string;
}

export interface WindowSpec {
  dayOfWeek: number;
  start: string;
  end: string;
}

export interface BlockedWindow {
  dayOfWeek: number;
  start: string;
  end: string;
  label?: string;
}

export interface Pod {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  schedulingCadence: SchedulingCadence;
  planningHorizonWeeks: number;
  reviewWindowHours: number;
  cycleDayOfWeek: number;
  cycleTimeOfDay: string;
  createdBy: string;
  createdAt: string;
}

export interface PodMember {
  podId: string;
  personId: string;
  role: PodRole;
  joinedAt: string | null;
}

export interface SubgroupConfig {
  label: string;
  memberIds: string[];
  frequencyPerCycle: number;
  durationHours: number;
  preferredWindows: WindowSpec[];
}

export interface PodPreference {
  id: string;
  podId: string;
  prefFullGatheringsPerCycle: number;
  prefGatheringDurationHours: number;
  subgroupConfigs: SubgroupConfig[];
}

export interface TimeBlock {
  id: string;
  cycleId: string;
  eventType: string;
  eventLabel: string | null;
  startTime: string;
  endTime: string;
  status: TimeBlockStatus;
  /** Current viewer's per-block response. Set on /schedule/proposals;
      undefined on payloads that don't include participant context. */
  myResponse?: ParticipantResponse;
  sourcePodId: string | null;
  partnershipId: string | null;
  satisfactionContribution: Record<string, unknown>;
}

export interface TimeBlockParticipant {
  timeBlockId: string;
  personId: string;
  response: ParticipantResponse;
  changeNote: string | null;
  respondedAt: string | null;
}

export interface SchedulingCycle {
  id: string;
  status: CycleStatus;
  horizonStart: string;
  horizonEnd: string;
  triggeredBy: string | null;
  triggerType: 'automatic' | 'manual' | 'reshuffle';
  personIds: string[];
  solverRunMs: number | null;
  satisfactionReport: SatisfactionReport[] | null;
  infeasibilityNotes: string[] | null;
  reviewWindowStart: string | null;
  reviewWindowEnd: string | null;
}

// ─── Optimizer contract (mirrors Pydantic models in apps/optimizer/src/models.py) ──

export interface FreeWindow {
  start: string; // ISO timestamp
  end: string;
}

export interface OptimizerPersonSpec {
  person_id: string;
  timezone: string;
  free_windows: FreeWindow[];
  solo_min_free_evenings: number;
  solo_min_free_weekend_days: number;
}

export interface OptimizerPartnerPreference {
  partnership_id?: string | null;
  partner_id: string;
  person_id: string;
  need_min_hours: number;
  need_min_date_nights: number;
  need_min_overnights: number;
  pref_ideal_hours: number;
  pref_date_nights: number;
  pref_overnights: number;
  pref_daytime_hangs: number;
  custom_prefs: CustomEventPref[];
  recurring_holds: RecurringHold[];
  preferred_windows: WindowSpec[];
}

export interface OptimizerEventType {
  label: string;
  duration_minutes: number;
  blocks_next_morning: boolean;
}

export interface OptimizerLockedBlock {
  start: string;
  end: string;
  participant_ids: string[];
}

export interface OptimizerPodGatheringPref {
  pod_id: string;
  member_ids: string[];
  frequency: number;
  duration_hours: number;
  preferred_windows: WindowSpec[];
}

export interface OptimizerSubgroupPref {
  label: string;
  member_ids: string[];
  frequency: number;
  duration_hours: number;
  preferred_windows: WindowSpec[];
}

export interface OptimizationRequest {
  horizon_start: string;
  horizon_end: string;
  persons: OptimizerPersonSpec[];
  partner_preferences: OptimizerPartnerPreference[];
  pod_gatherings: OptimizerPodGatheringPref[];
  subgroup_prefs: OptimizerSubgroupPref[];
  event_types: OptimizerEventType[];
  locked_blocks: OptimizerLockedBlock[];
  slot_duration_minutes?: number;
}

export interface ProposedBlock {
  event_type: string;
  start: string;
  end: string;
  participant_ids: string[];
  partnership_id: string | null;
  pod_id: string | null;
  satisfaction_contribution: Record<string, number>;
}

export interface SatisfactionReport {
  person_id: string;
  overall_pct: number;
  per_partner: Record<
    string,
    { need_met: boolean; pref_pct: number; hours_scheduled: number; hours_wanted: number }
  >;
  unmet_needs: string[];
}

export interface OptimizationResponse {
  proposed_blocks: ProposedBlock[];
  satisfaction_scores: SatisfactionReport[];
  infeasibility_notes: string[];
  solver_time_ms: number;
  slot_count: number;
  variable_count: number;
}

// ─── API response shapes ──────────────────────────────────────

export interface CalendarConnectionSummary {
  id: string;
  provider: CalendarProviderName;
  lastSyncedAt: string | null;
  syncError: string | null;
  scopes: string[];
}

export interface PartnerSummary {
  partnershipId: string;
  partner: Pick<Person, 'id' | 'displayName' | 'avatarUrl'>;
  myPreferences: PartnershipPreference | null;
  color: string;
  status: PartnershipStatus;
}
