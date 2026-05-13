// Mirror of Postgres enums (per arch § 4.2). Keep in sync with schema.

export const PARTNERSHIP_STATUS = ['invited', 'active', 'paused', 'archived'] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUS)[number];

export const SCHEDULING_CADENCE = ['weekly', 'biweekly', 'monthly'] as const;
export type SchedulingCadence = (typeof SCHEDULING_CADENCE)[number];

export const CALENDAR_PROVIDER = ['google', 'icloud', 'outlook'] as const;
export type CalendarProviderName = (typeof CALENDAR_PROVIDER)[number];

export const TIME_BLOCK_STATUS = [
  'proposed',
  'accepted',
  'locked',
  'declined',
  'reshuffled',
  'cancelled',
] as const;
export type TimeBlockStatus = (typeof TIME_BLOCK_STATUS)[number];

export const PARTICIPANT_RESPONSE = [
  'pending',
  'accepted',
  'declined',
  'change_requested',
] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSE)[number];

export const CYCLE_STATUS = [
  'collecting',
  'optimizing',
  'proposed',
  'negotiating',
  'locked',
  'failed',
] as const;
export type CycleStatus = (typeof CYCLE_STATUS)[number];

export const NOTIFICATION_CHANNEL = ['in_app', 'telegram', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

export const POD_ROLE = ['admin', 'member'] as const;
export type PodRole = (typeof POD_ROLE)[number];

/**
 * Distinguishes romantic partnerships from platonic friendships. Stored on
 * partnerships + partner_invites; affects which preference fields the UI
 * exposes (friendships hide overnights / date nights) but not the optimizer.
 */
export const RELATIONSHIP_TYPE = ['partnership', 'friendship'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPE)[number];
