/**
 * Shared UI constants. Hoisted here so the timezone picker and cadence labels
 * have a single source of truth instead of being copy-pasted across pages.
 */
import type { SchedulingCadence } from '@pod-life/shared';

/** Common IANA timezones offered in the picker. Users can still be in others;
 * this is just a convenient shortlist for onboarding/settings. */
export const COMMON_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'UTC',
] as const;

/** Human label for a scheduling cadence. */
export function cadenceLabel(c: SchedulingCadence): string {
  switch (c) {
    case 'weekly':
      return 'Weekly';
    case 'biweekly':
      return 'Every 2 weeks';
    case 'monthly':
      return 'Monthly';
    default:
      return c;
  }
}

/** Cadence options for a <select>, label + value. */
export const CADENCE_OPTIONS: ReadonlyArray<{ value: SchedulingCadence; label: string }> = [
  { value: 'weekly', label: cadenceLabel('weekly') },
  { value: 'biweekly', label: cadenceLabel('biweekly') },
  { value: 'monthly', label: cadenceLabel('monthly') },
];
