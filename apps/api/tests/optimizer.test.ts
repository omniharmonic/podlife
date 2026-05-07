/**
 * Inline optimizer parity tests.
 *
 * These mirror apps/optimizer/tests/test_solver.py — same fixtures, same
 * assertions. The TS port must satisfy the same behavioral contract as the
 * canonical Python implementation: hard minimums met, no double-booking,
 * maximin spread bounded, infeasibility surfaced cleanly.
 */
import { describe, it, expect } from 'vitest';
import { solve } from '../src/services/optimizer/index.ts';
import {
  HORIZON_START,
  eveningWindows,
  multiPodConflict,
  noOverlapPair,
  oversubscribed,
  tenPersonsFiveCouples,
  triadBasic,
  vStructure,
} from '../src/services/optimizer/fixtures.ts';
import type { ProposedBlock } from '@pod-life/shared';

function hoursForPair(blocks: ProposedBlock[], a: string, b: string): number {
  const target = new Set([a, b]);
  let total = 0;
  for (const blk of blocks) {
    if (blk.participant_ids.length !== 2) continue;
    const set = new Set(blk.participant_ids);
    if (set.size === target.size && [...set].every((x) => target.has(x))) {
      total += blk.satisfaction_contribution[a] ?? 0;
    }
  }
  return total;
}

describe('inline optimizer — parity with Python', () => {
  it('triad: every person gets at least one block', async () => {
    const resp = await solve(triadBasic());
    expect(resp.proposed_blocks.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const b of resp.proposed_blocks) for (const p of b.participant_ids) seen.add(p);
    expect(seen).toEqual(new Set(['A', 'B', 'C']));
    for (const s of resp.satisfaction_scores) {
      expect(s.overall_pct).toBeGreaterThan(30);
    }
    expect(resp.solver_time_ms).toBeLessThan(5000);
  });

  it('v-structure: A splits time between B and C, both minimums met', async () => {
    const resp = await solve(vStructure());
    expect(resp.proposed_blocks.length).toBeGreaterThan(0);
    const ab = hoursForPair(resp.proposed_blocks, 'A', 'B');
    const ac = hoursForPair(resp.proposed_blocks, 'A', 'C');
    // V-structure: B's side states need 6h, A's side states need 4h with B.
    // The pair-level cap aggregates to max(6, 4) = 6h.
    expect(ab).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(ac).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(ab).toBeGreaterThan(0);
    expect(ac).toBeGreaterThan(0);
    // No B↔C blocks (not partners).
    for (const b of resp.proposed_blocks) {
      const set = new Set(b.participant_ids);
      expect(!(set.has('B') && set.has('C') && !set.has('A'))).toBe(true);
    }
  });

  it('multi-pod: A is split between B and C without double-booking', async () => {
    const resp = await solve(multiPodConflict());
    expect(resp.proposed_blocks.length).toBeGreaterThan(0);
    const ab = hoursForPair(resp.proposed_blocks, 'A', 'B');
    const ac = hoursForPair(resp.proposed_blocks, 'A', 'C');
    expect(ab).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(ac).toBeGreaterThanOrEqual(5 - 1e-6);

    // No A overlap.
    const aBlocks = resp.proposed_blocks.filter((b) => b.participant_ids.includes('A'));
    for (let i = 0; i < aBlocks.length; i++) {
      for (let j = i + 1; j < aBlocks.length; j++) {
        const b1 = aBlocks[i]!;
        const b2 = aBlocks[j]!;
        const overlap =
          new Date(Math.max(new Date(b1.start).getTime(), new Date(b2.start).getTime())) <
          new Date(Math.min(new Date(b1.end).getTime(), new Date(b2.end).getTime()));
        expect(overlap).toBe(false);
      }
    }
  });

  it('multi-pod infeasible: 12h+12h beyond A’s 4 evenings → flagged', async () => {
    const cfg = multiPodConflict();
    for (const p of cfg.partner_preferences) {
      if ((p.person_id === 'B' || p.person_id === 'C') && p.partner_id === 'A') {
        p.need_min_hours = 12;
        p.pref_ideal_hours = 12;
      }
    }
    const resp = await solve(cfg);
    if (resp.proposed_blocks.length > 0) {
      // Partial schedule: at least one need must be unmet.
      expect(resp.satisfaction_scores.some((s) => s.unmet_needs.length > 0)).toBe(true);
    } else {
      expect(resp.infeasibility_notes.length).toBeGreaterThan(0);
    }
  });

  it('oversubscribed: maximin spreads time roughly evenly', async () => {
    const resp = await solve(oversubscribed());
    expect(resp.proposed_blocks.length).toBeGreaterThan(0);

    const pairHours: Record<string, number> = {};
    for (let i = 1; i <= 4; i++) {
      pairHours[`P${i}`] = hoursForPair(resp.proposed_blocks, 'A', `P${i}`);
    }
    for (const [partner, hrs] of Object.entries(pairHours)) {
      expect(hrs).toBeGreaterThanOrEqual(2 - 1e-6); // hard min
      void partner;
    }
    const maxH = Math.max(...Object.values(pairHours));
    const minH = Math.min(...Object.values(pairHours));
    expect(maxH - minH).toBeLessThanOrEqual(4); // matches Python tolerance
  });

  it('no-overlap pair: empty schedule with infeasibility notes', async () => {
    const resp = await solve(noOverlapPair());
    expect(resp.proposed_blocks).toEqual([]);
    expect(resp.infeasibility_notes.length).toBeGreaterThan(0);
    expect(resp.variable_count).toBe(0);
  });

  it('10 persons × 7 days: solves under 5s with feasible schedule', async () => {
    const resp = await solve(tenPersonsFiveCouples());
    expect(resp.proposed_blocks.length).toBeGreaterThan(0);
    expect(resp.solver_time_ms).toBeLessThan(5000);
  });

  it('returns empty response for trivially impossible request', async () => {
    // A free 8–12 UTC, B free 18–22 UTC, both date 2026-05-11.
    const aStart = new Date(HORIZON_START);
    aStart.setUTCHours(8);
    const aEnd = new Date(HORIZON_START);
    aEnd.setUTCHours(12);
    const bStart = new Date(HORIZON_START);
    bStart.setUTCHours(18);
    const bEnd = new Date(HORIZON_START);
    bEnd.setUTCHours(22);
    const resp = await solve({
      horizon_start: HORIZON_START.toISOString(),
      horizon_end: new Date(HORIZON_START.getTime() + 7 * 86400_000).toISOString(),
      persons: [
        {
          person_id: 'A',
          timezone: 'UTC',
          free_windows: [{ start: aStart.toISOString(), end: aEnd.toISOString() }],
          solo_min_free_evenings: 0,
          solo_min_free_weekend_days: 0,
        },
        {
          person_id: 'B',
          timezone: 'UTC',
          free_windows: [{ start: bStart.toISOString(), end: bEnd.toISOString() }],
          solo_min_free_evenings: 0,
          solo_min_free_weekend_days: 0,
        },
      ],
      partner_preferences: [
        {
          person_id: 'A',
          partner_id: 'B',
          partnership_id: null,
          pref_ideal_hours: 4,
          need_min_hours: 0,
          need_min_date_nights: 0,
          need_min_overnights: 0,
          pref_date_nights: 0,
          pref_overnights: 0,
          pref_daytime_hangs: 0,
          custom_prefs: [],
          recurring_holds: [],
          preferred_windows: [],
        },
      ],
      pod_gatherings: [],
      subgroup_prefs: [],
      event_types: [{ label: 'Date Night', duration_minutes: 180, blocks_next_morning: false }],
      locked_blocks: [],
      slot_duration_minutes: 30,
    });
    expect(resp.proposed_blocks).toEqual([]);
    expect(resp.infeasibility_notes.length).toBeGreaterThan(0);
    void eveningWindows;
  });
});
