import { afterEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import {
  invertToFreeWindows,
  mergeOverlappingWindows,
} from '../src/services/calendar/calendar.aggregator.ts';

describe('calendar aggregator', () => {
  it('merges overlapping windows', () => {
    const a = new Date('2026-05-10T09:00Z');
    const b = new Date('2026-05-10T10:00Z');
    const c = new Date('2026-05-10T10:30Z');
    const d = new Date('2026-05-10T12:00Z');
    const e = new Date('2026-05-10T13:00Z');
    const f = new Date('2026-05-10T14:00Z');
    const merged = mergeOverlappingWindows([
      { start: a, end: b },
      { start: c, end: d },
      { start: e, end: f },
      { start: b, end: c }, // adjacent — should chain a..d
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.start.getTime()).toBe(a.getTime());
    expect(merged[0]!.end.getTime()).toBe(d.getTime());
    expect(merged[1]!.start.getTime()).toBe(e.getTime());
    expect(merged[1]!.end.getTime()).toBe(f.getTime());
  });

  it('inverts busy windows into free windows over a range', () => {
    const start = new Date('2026-05-10T08:00Z');
    const end = new Date('2026-05-10T18:00Z');
    const busy = [
      { start: new Date('2026-05-10T10:00Z'), end: new Date('2026-05-10T11:00Z') },
      { start: new Date('2026-05-10T13:00Z'), end: new Date('2026-05-10T14:00Z') },
    ];
    const free = invertToFreeWindows(busy, start, end);
    expect(free).toHaveLength(3);
    expect(free[0]!.start.getTime()).toBe(start.getTime());
    expect(free[0]!.end.toISOString()).toBe('2026-05-10T10:00:00.000Z');
    expect(free[1]!.start.toISOString()).toBe('2026-05-10T11:00:00.000Z');
    expect(free[2]!.end.getTime()).toBe(end.getTime());
  });

  it('handles fully-busy range -> no free windows', () => {
    const start = new Date('2026-05-10T08:00Z');
    const end = new Date('2026-05-10T10:00Z');
    const free = invertToFreeWindows(
      [{ start: new Date('2026-05-10T07:00Z'), end: new Date('2026-05-10T11:00Z') }],
      start,
      end,
    );
    expect(free).toHaveLength(0);
  });
});

describe('manual availability roundtrip', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('stores and reads manual windows', async () => {
    const app = newApp();
    const email = uniqueEmail('mavail');
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const token = v.body.sessionToken;

    const windows = [
      { start: '2026-05-10T18:00:00.000Z', end: '2026-05-10T22:00:00.000Z' },
      { start: '2026-05-11T18:00:00.000Z', end: '2026-05-11T22:00:00.000Z' },
    ];
    const post = await call(app, '/api/me/availability/manual', {
      method: 'POST',
      token,
      json: { windows },
    });
    expect(post.status).toBe(200);
    expect(post.body.count).toBe(2);

    const get = await call(
      app,
      `/api/me/availability?start=${windows[0]!.start}&end=${windows[1]!.end}`,
      { token },
    );
    expect(get.status).toBe(200);
    expect(get.body.windows.length).toBeGreaterThanOrEqual(1);
  });
});
