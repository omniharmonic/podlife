import { z } from 'zod';
import {
  PARTNERSHIP_STATUS,
  SCHEDULING_CADENCE,
  CALENDAR_PROVIDER,
  TIME_BLOCK_STATUS,
  PARTICIPANT_RESPONSE,
  CYCLE_STATUS,
  POD_ROLE,
  NOTIFICATION_CHANNEL,
} from './enums.js';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM');
const DayOfWeek = z.number().int().min(0).max(6);

export const recurringHoldSchema = z.object({
  dayOfWeek: DayOfWeek,
  start: HHMM,
  end: HHMM,
  eventType: z.string().min(1),
  label: z.string().optional(),
});

export const windowSpecSchema = z.object({
  dayOfWeek: DayOfWeek,
  start: HHMM,
  end: HHMM,
});

export const blockedWindowSchema = z.object({
  dayOfWeek: DayOfWeek,
  start: HHMM,
  end: HHMM,
  label: z.string().optional(),
});

export const customEventPrefSchema = z.object({
  label: z.string().min(1),
  durationHours: z.number().positive(),
  prefCount: z.number().int().min(0),
});

export const subgroupConfigSchema = z.object({
  label: z.string().min(1),
  memberIds: z.array(z.string().uuid()).min(2),
  frequencyPerCycle: z.number().int().min(0),
  durationHours: z.number().positive(),
  preferredWindows: z.array(windowSpecSchema).default([]),
});

// ─── Auth ──────────────────────────────────────────────────────

export const requestLoginCodeSchema = z.object({
  email: z.string().email().toLowerCase(),
});

// `token` is kept as the wire field name to keep the existing client + test
// surface working, but it now carries a 6-character code. We accept anything
// 4–32 chars long here and let the service do the strict normalize+verify.
export const verifyLoginCodeSchema = z.object({
  email: z.string().email().toLowerCase(),
  token: z.string().min(4).max(32),
});

// Back-compat aliases — the magic-link names are referenced from a few
// service modules that we'll migrate piecemeal. Safe to remove once all
// imports have been switched over.
export const requestMagicLinkSchema = requestLoginCodeSchema;
export const verifyMagicLinkSchema = verifyLoginCodeSchema;

// ─── Person ────────────────────────────────────────────────────

export const updatePersonSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  timezone: z.string().min(3).optional(),
  telegramHandle: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  soloMinFreeEveningsPerWeek: z.number().int().min(0).max(7).optional(),
  soloMinFreeWeekendDaysPerMonth: z.number().int().min(0).max(8).optional(),
  blockedWindows: z.array(blockedWindowSchema).optional(),
  notificationChannels: z.array(z.enum(NOTIFICATION_CHANNEL)).optional(),
  // P9.3: opt-in scheduling jitter to reduce timing-pattern inference.
  privacyMode: z.boolean().optional(),
  // ISO timestamp marking onboarding completion.
  onboardedAt: z.string().datetime().nullable().optional(),
});

// ─── Partner ───────────────────────────────────────────────────

export const inviteParterSchema = z.object({
  displayHint: z.string().max(80).optional(),
});

export const updatePartnershipPreferencesSchema = z
  .object({
    cadence: z.enum(SCHEDULING_CADENCE).optional(),
    needMinHours: z.number().min(0).max(168).optional(),
    needMinDateNights: z.number().int().min(0).max(20).optional(),
    needMinOvernights: z.number().int().min(0).max(20).optional(),
    prefIdealHours: z.number().min(0).max(168).optional(),
    prefDateNights: z.number().int().min(0).max(20).optional(),
    prefOvernights: z.number().int().min(0).max(20).optional(),
    prefDaytimeHangs: z.number().int().min(0).max(20).optional(),
    customEventPrefs: z.array(customEventPrefSchema).optional(),
    recurringHolds: z.array(recurringHoldSchema).optional(),
    preferredWindows: z.array(windowSpecSchema).optional(),
  })
  .refine(
    (v) =>
      v.needMinHours === undefined ||
      v.prefIdealHours === undefined ||
      v.needMinHours <= v.prefIdealHours,
    { message: 'need_min_hours must be ≤ pref_ideal_hours', path: ['needMinHours'] },
  );

export const updatePartnershipStatusSchema = z.object({
  status: z.enum(PARTNERSHIP_STATUS),
});

// ─── Pod ───────────────────────────────────────────────────────

export const createPodSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  emoji: z.string().max(8).default('🏠'),
  schedulingCadence: z.enum(SCHEDULING_CADENCE).default('weekly'),
  planningHorizonWeeks: z.number().int().min(1).max(8).default(1),
  reviewWindowHours: z.number().int().min(1).max(168).default(48),
  cycleDayOfWeek: DayOfWeek.default(0),
  cycleTimeOfDay: HHMM.default('20:00'),
});

export const updatePodSchema = createPodSchema.partial();

export const updatePodPreferencesSchema = z.object({
  prefFullGatheringsPerCycle: z.number().int().min(0).max(20).optional(),
  prefGatheringDurationHours: z.number().positive().max(24).optional(),
  subgroupConfigs: z.array(subgroupConfigSchema).optional(),
});

export const invitePodMemberSchema = z.object({
  role: z.enum(POD_ROLE).default('member'),
});

// ─── Schedule ──────────────────────────────────────────────────

export const runCycleSchema = z.object({
  podId: z.string().uuid().optional(),
  horizonStart: z.string().datetime().optional(),
  horizonEnd: z.string().datetime().optional(),
});

export const respondToProposalSchema = z.object({
  response: z.enum(['accepted', 'declined', 'change_requested']),
  changeNote: z.string().max(500).optional(),
});

export const reshuffleRequestSchema = z.object({
  blockId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  preferredAlternative: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
});

// ─── Calendar (manual availability fallback when no provider connected) ──

export const manualAvailabilityWindowSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});

export const setManualAvailabilitySchema = z.object({
  windows: z.array(manualAvailabilityWindowSchema).max(200),
});

// ─── Re-export enum schemas for convenience ───────────────────

export const partnershipStatusSchema = z.enum(PARTNERSHIP_STATUS);
export const schedulingCadenceSchema = z.enum(SCHEDULING_CADENCE);
export const calendarProviderSchema = z.enum(CALENDAR_PROVIDER);
export const timeBlockStatusSchema = z.enum(TIME_BLOCK_STATUS);
export const participantResponseSchema = z.enum(PARTICIPANT_RESPONSE);
export const cycleStatusSchema = z.enum(CYCLE_STATUS);
export const podRoleSchema = z.enum(POD_ROLE);
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL);
