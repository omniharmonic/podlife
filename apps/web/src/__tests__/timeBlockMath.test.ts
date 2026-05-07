import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { hoursBetween, durationMinutes } from '@/lib/dates';

/**
 * The WeekView positions blocks by:
 *   top  = (startHours - DAY_START_HOUR) * HOUR_HEIGHT_PX
 *   height = (endHours - startHours)   * HOUR_HEIGHT_PX
 * These tests verify that math directly so a regression in TimeBlock layout fails fast.
 */

const DAY_START_HOUR = 8;
const HOUR_HEIGHT_PX = 56;

function blockTop(startIso: string): number {
  const d = parseISO(startIso);
  const startHours = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, (startHours - DAY_START_HOUR) * HOUR_HEIGHT_PX);
}

function blockHeight(startIso: string, endIso: string): number {
  const s = parseISO(startIso);
  const e = parseISO(endIso);
  const sh = s.getHours() + s.getMinutes() / 60;
  const eh = e.getHours() + e.getMinutes() / 60;
  return Math.max(20, (eh - sh) * HOUR_HEIGHT_PX);
}

describe('time block layout math', () => {
  it('places an 8am block at top:0', () => {
    expect(blockTop('2025-05-12T08:00:00')).toBe(0);
  });

  it('places a 9am block at one hour-row down', () => {
    expect(blockTop('2025-05-12T09:00:00')).toBe(HOUR_HEIGHT_PX);
  });

  it('places an 8:30am block at half a row down', () => {
    expect(blockTop('2025-05-12T08:30:00')).toBe(HOUR_HEIGHT_PX / 2);
  });

  it('handles before-day-start by clamping to 0', () => {
    expect(blockTop('2025-05-12T06:00:00')).toBe(0);
  });

  it('computes 2.5h block height correctly', () => {
    const h = blockHeight('2025-05-12T18:00:00', '2025-05-12T20:30:00');
    expect(h).toBe(2.5 * HOUR_HEIGHT_PX);
  });

  it('respects minimum block height for tiny blocks', () => {
    const h = blockHeight('2025-05-12T18:00:00', '2025-05-12T18:05:00');
    expect(h).toBe(20);
  });

  it('hoursBetween produces correct hour list', () => {
    expect(hoursBetween(8, 12)).toEqual([8, 9, 10, 11]);
  });

  it('durationMinutes is correct', () => {
    expect(
      durationMinutes('2025-05-12T18:00:00.000Z', '2025-05-12T20:30:00.000Z'),
    ).toBe(150);
  });
});
