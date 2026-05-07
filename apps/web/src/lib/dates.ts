import {
  addDays,
  addMinutes,
  differenceInMinutes,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
} from 'date-fns';

/** Monday-start week. Returns the Date at midnight local of that Monday. */
export function getWeekStart(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

export function getWeekEnd(d: Date): Date {
  return endOfWeek(d, { weekStartsOn: 1 });
}

export function getWeekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = format(weekStart, 'MMM') === format(weekEnd, 'MMM');
  if (sameMonth) {
    return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'd, yyyy')}`;
  }
  return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;
}

export function formatTimeShort(d: Date | string): string {
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, 'h:mm a').toLowerCase().replace(':00', '');
}

export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${formatTimeShort(start)} – ${formatTimeShort(end)}`;
}

export function formatDayShort(d: Date | string): string {
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, 'EEE, MMM d');
}

/** Returns hours from start through (end - 1). Used for hour-row rendering. */
export function hoursBetween(startHour: number, endHour: number): number[] {
  const out: number[] = [];
  for (let h = startHour; h < endHour; h++) out.push(h);
  return out;
}

/** Number of minutes between two ISO strings. */
export function durationMinutes(startIso: string, endIso: string): number {
  return differenceInMinutes(parseISO(endIso), parseISO(startIso));
}

/** Format duration like "2h 30m". */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export {
  addDays,
  addMinutes,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
  endOfWeek,
};
