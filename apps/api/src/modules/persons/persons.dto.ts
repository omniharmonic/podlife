import type { Person } from '@pod-life/shared';
import type { PersonRow } from '../../db/schema.js';

export function toPersonDto(row: PersonRow): Person {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    timezone: row.timezone,
    telegramHandle: row.telegramHandle,
    avatarUrl: row.avatarUrl,
    soloMinFreeEveningsPerWeek: row.soloMinFreeEveningsPerWeek,
    soloMinFreeWeekendDaysPerMonth: row.soloMinFreeWeekendDaysPerMonth,
    notificationChannels: (row.notificationChannels ?? ['in_app']) as Person['notificationChannels'],
    privacyMode: row.privacyMode,
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
