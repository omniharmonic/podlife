/**
 * MILP solver — TypeScript port of apps/optimizer/src/solver.py.
 *
 * The Python source is the canonical reference; behavior here must match it
 * within tolerance. Comments below cite the relevant constraint groups; see
 * the Python file's docstring for the full mathematical formulation.
 *
 * The npm `highs` package compiles HiGHS to WebAssembly. It accepts an
 * LP-format string (CPLEX LP format) rather than the imperative
 * addRow/addVar API of highspy, so this port builds the LP text in
 * memory and hands it off in one call.
 *
 * Hot-path optimization: the WASM module is loaded once and cached.
 * Vercel's Fluid Compute reuses warm instances across invocations, so
 * cold-start cost (~50ms) is amortized.
 */
import highsLoader from 'highs';
import type {
  OptimizationRequest,
  OptimizationResponse,
  ProposedBlock,
  SatisfactionReport,
  OptimizerPersonSpec,
} from '@pod-life/shared';
import { discoverCandidateSlots } from './slot-discovery.js';
import { type CandidateSlot, type PreparedRequest, participantKeyOf } from './types.js';

// ── Tunable constants — must match solver.py ────────────────────────────
const SOLVER_TIME_LIMIT_SECONDS = 5.0;
const EPSILON_PAIR_FAIRNESS = 1e-3;
const EPSILON_POD_BONUS = 1e-2;
const OVERSHOOT_FACTOR = 1.5;

// ── HiGHS WASM module loader ────────────────────────────────────────────
// We do NOT memoize the module across solve() calls. The npm `highs` v1.8
// wrapper carries internal state in the WASM heap (logging buffers,
// solution-file scratch space) that does not get cleanly reset between
// calls, leading to "Too few lines" / "Aborted" errors on the second
// large solve. Reloading the WASM module costs ~50ms per call, which is
// the price we pay for reliability. (Verified 2026-05-07.)
type HighsModule = Awaited<ReturnType<typeof highsLoader>>;
function getHighs(): Promise<HighsModule> {
  return highsLoader();
}

// ── Public entry point ─────────────────────────────────────────────────
export async function solve(request: OptimizationRequest): Promise<OptimizationResponse> {
  const startTime = Date.now();
  const prepared = prepareRequest(request);

  // PHASE 1: Discover candidate slots.
  const candidates = discoverCandidateSlots(prepared);

  if (candidates.length === 0) {
    const notes = ['No overlapping free time found for any pair.'];
    const empty = emptyScores(request, notes);
    notes.push(...analyzeGaps(empty, request));
    return {
      proposed_blocks: [],
      satisfaction_scores: empty,
      infeasibility_notes: notes,
      solver_time_ms: Date.now() - startTime,
      slot_count: prepared.horizonSlots,
      variable_count: 0,
    };
  }

  // PHASE 2: Build the LP and solve.
  const lp = buildLp(candidates, prepared);
  // Don't pass `output_flag: false` or `log_to_console: false`. The npm
  // `highs` v1.8 wrapper scrapes the solution from stdout — suppressing
  // logging breaks solution parsing entirely (verified 2026-05-07).
  //
  // Layered retry strategy: HiGHS WASM v1.8 has a known bug where its MIP
  // branch-and-bound crashes ("null function or function signature mismatch"
  // / "Aborted") on certain LP shapes — typically problems with multiple
  // large per-person maximin rows over many binary vars. The looser
  // mip_feasibility_tolerance (0.1) bypasses the crash at the cost of
  // sometimes returning slightly suboptimal incumbents. We try strict
  // first, fall back to loose, and only declare infeasibility on a second
  // crash.
  let result: ReturnType<HighsModule['solve']> | null = null;
  let lastErr: Error | null = null;
  const attempts = [
    { time_limit: SOLVER_TIME_LIMIT_SECONDS },
    { time_limit: SOLVER_TIME_LIMIT_SECONDS, mip_feasibility_tolerance: 0.1 },
  ];
  for (const opts of attempts) {
    const highs = await getHighs();
    try {
      result = highs.solve(lp, opts);
      break;
    } catch (err) {
      lastErr = err as Error;
      result = null;
    }
  }
  if (!result) {
    const status = lastErr?.message ?? 'solver failed';
    const notes = buildInfeasibilityNotes(request, status);
    const empty = emptyScores(request, notes);
    notes.push(...analyzeGaps(empty, request));
    return {
      proposed_blocks: [],
      satisfaction_scores: empty,
      infeasibility_notes: notes,
      solver_time_ms: Date.now() - startTime,
      slot_count: prepared.horizonSlots,
      variable_count: candidates.length + 2,
    };
  }
  const solverTimeMs = Date.now() - startTime;
  const numVars = candidates.length + 2;

  // Optimal or time-limited-but-feasible both yield a usable solution.
  // The HiGHS WASM API exposes status as a human-readable string; the values
  // we accept mirror highspy's {kOptimal, kTimeLimit, kSolutionLimit}.
  const status = result.Status as string;
  const acceptableStatuses = new Set([
    'Optimal',
    'Time limit reached',
    'Iteration limit reached',
    'Bound on objective reached',
    'Target for objective reached',
  ]);

  if (!acceptableStatuses.has(status)) {
    const notes = buildInfeasibilityNotes(request, status);
    const empty = emptyScores(request, notes);
    notes.push(...analyzeGaps(empty, request));
    return {
      proposed_blocks: [],
      satisfaction_scores: empty,
      infeasibility_notes: notes,
      solver_time_ms: solverTimeMs,
      slot_count: prepared.horizonSlots,
      variable_count: numVars,
    };
  }

  // Extract chosen candidates (Primal > 0.5 for binary vars).
  const proposed: ProposedBlock[] = [];
  for (let ci = 0; ci < candidates.length; ci++) {
    const col = result.Columns[`x${ci}`];
    if (!col) continue;
    const primal = (col as { Primal?: number }).Primal;
    if (primal == null || primal <= 0.5) continue;

    const cand = candidates[ci]!;
    const blockStart = new Date(
      prepared.horizonStart.getTime() + cand.startSlot * prepared.slotMinutes * 60_000,
    );
    const blockEnd = new Date(
      prepared.horizonStart.getTime() + cand.endSlot * prepared.slotMinutes * 60_000,
    );
    const contribution: Record<string, number> = {};
    for (const pid of cand.participantIds) contribution[pid] = cand.durationHours;

    proposed.push({
      event_type: cand.eventType,
      start: blockStart.toISOString(),
      end: blockEnd.toISOString(),
      participant_ids: [...cand.participantIds],
      partnership_id: cand.partnershipId,
      pod_id: cand.podId,
      satisfaction_contribution: contribution,
    });
  }

  const scores = computeSatisfaction(proposed, request);
  const gapNotes = analyzeGaps(scores, request);

  return {
    proposed_blocks: proposed,
    satisfaction_scores: scores,
    infeasibility_notes: gapNotes,
    solver_time_ms: solverTimeMs,
    slot_count: prepared.horizonSlots,
    variable_count: numVars,
  };
}

// ── Prepared request ────────────────────────────────────────────────────
function prepareRequest(request: OptimizationRequest): PreparedRequest {
  const horizonStart = new Date(request.horizon_start);
  const horizonEnd = new Date(request.horizon_end);
  const slotMinutes = request.slot_duration_minutes ?? 30;
  const horizonSeconds = (horizonEnd.getTime() - horizonStart.getTime()) / 1000;
  const horizonSlots = Math.trunc(horizonSeconds / 60 / slotMinutes);
  return { raw: request, horizonStart, horizonEnd, horizonSlots, horizonSeconds, slotMinutes };
}

// ── LP construction ─────────────────────────────────────────────────────
//
// We emit CPLEX LP format. Every candidate i becomes binary variable x{i};
// the two continuous fairness variables are `z` (per-person maximin) and
// `z_pair` (per-pair maximin). Lexicographic objective is encoded with
// small-ε weights small enough that any 1% movement in z dominates them.
//
// We minimize  -z - ε_pair·z_pair - ε_pod·Σ(pod-bonus x[i])
// which is equivalent to maximizing the lexicographic order.

interface LpTerm {
  coef: number;
  varName: string;
}

function fmtCoef(coef: number): string {
  // LP format requires no scientific-notation coefficients in some implementations.
  // Use fixed precision; HiGHS accepts integers and decimals like "0.5".
  if (Number.isInteger(coef)) return String(coef);
  // Up to 6 decimal places is plenty for our problem (slot durations are
  // multiples of 0.5h; pref hours are typically integers or halves).
  return coef.toFixed(6).replace(/\.?0+$/, '');
}

/**
 * Format a list of terms as an LP linear expression, wrapping long
 * expressions across continuation lines. CPLEX LP format permits a
 * constraint or objective to span multiple lines as long as continuation
 * lines start with `+` or `-` operators. HiGHS's reader hits an internal
 * limit on very long single lines, so we wrap aggressively.
 */
function fmtTerms(terms: LpTerm[], leadSign = false): string {
  if (terms.length === 0) return '';
  // Term-cluster size for line wrapping. Empirically: 8 keeps lines under
  // ~120 chars even with 20-char variable names.
  const TERMS_PER_LINE = 8;

  const parts: string[] = [];
  for (let i = 0; i < terms.length; i++) {
    const { coef, varName } = terms[i]!;
    if (i === 0 && !leadSign) {
      if (coef === 1) parts.push(varName);
      else if (coef === -1) parts.push(`-${varName}`);
      else parts.push(`${fmtCoef(coef)} ${varName}`);
    } else {
      const abs = Math.abs(coef);
      const sign = coef < 0 ? '-' : '+';
      if (abs === 1) parts.push(`${sign} ${varName}`);
      else parts.push(`${sign} ${fmtCoef(abs)} ${varName}`);
    }
  }

  // Group into chunks of TERMS_PER_LINE; join chunks with newlines so
  // HiGHS's LP reader sees a continuation per chunk.
  if (parts.length <= TERMS_PER_LINE) return parts.join(' ');
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += TERMS_PER_LINE) {
    chunks.push(parts.slice(i, i + TERMS_PER_LINE).join(' '));
  }
  // Indent continuation lines for readability when dumping the LP.
  return chunks.join('\n     ');
}

function buildLp(candidates: CandidateSlot[], prepared: PreparedRequest): string {
  const { raw } = prepared;
  const n = candidates.length;

  const lines: string[] = [];

  // ── Objective ────────────────────────────────────────────────────────
  // -z - ε_pair·z_pair - ε_pod · Σ(is_pod_block ? 1 : 0) · x[i]
  const objTerms: LpTerm[] = [];
  objTerms.push({ coef: -1, varName: 'z' });
  objTerms.push({ coef: -EPSILON_PAIR_FAIRNESS, varName: 'z_pair' });
  for (let i = 0; i < n; i++) {
    const cand = candidates[i]!;
    const isPodBlock = cand.podId !== null || cand.participantIds.length >= 3;
    if (isPodBlock) objTerms.push({ coef: -EPSILON_POD_BONUS, varName: `x${i}` });
  }
  lines.push('Minimize');
  lines.push(`  obj: ${fmtTerms(objTerms)}`);

  // ── Subject To ───────────────────────────────────────────────────────
  lines.push('Subject To');
  let cIdx = 0;
  const addRow = (terms: LpTerm[], op: '<=' | '>=' | '=', rhs: number): void => {
    if (terms.length === 0) return;
    const expr = fmtTerms(terms);
    if (!expr) return;
    lines.push(`  c${cIdx++}: ${expr} ${op} ${fmtCoef(rhs)}`);
  };

  // CONSTRAINT 1: No double-booking. For each (slot, person) pair touched
  // by ≥2 candidates, sum ≤ 1.
  const slotPersonMap = new Map<string, number[]>();
  for (let ci = 0; ci < n; ci++) {
    const cand = candidates[ci]!;
    for (let s = cand.startSlot; s < cand.endSlot; s++) {
      for (const pid of cand.participantIds) {
        const key = `${s}|${pid}`;
        let arr = slotPersonMap.get(key);
        if (!arr) {
          arr = [];
          slotPersonMap.set(key, arr);
        }
        arr.push(ci);
      }
    }
  }
  for (const candIndices of slotPersonMap.values()) {
    if (candIndices.length > 1) {
      addRow(
        candIndices.map((ci) => ({ coef: 1, varName: `x${ci}` })),
        '<=',
        1,
      );
    }
  }

  // CONSTRAINT 2: Hard minimums per partner pair.
  // Aggregate need_min_hours per unordered pair (max of both sides).
  const pairNeedHours = new Map<string, number>();
  for (const pref of raw.partner_preferences) {
    if (pref.need_min_hours <= 0) continue;
    const key = participantKeyOf([pref.person_id, pref.partner_id]);
    pairNeedHours.set(key, Math.max(pairNeedHours.get(key) ?? 0, pref.need_min_hours));
  }
  for (const [key, needHours] of pairNeedHours) {
    const terms: LpTerm[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cand = candidates[ci]!;
      if (cand.participantKey === key && cand.participantIds.length === 2) {
        terms.push({ coef: cand.durationHours, varName: `x${ci}` });
      }
    }
    if (terms.length > 0) addRow(terms, '>=', needHours);
  }

  // CONSTRAINT 3: Per-person maximin (pair-only blocks count).
  for (const person of raw.persons) {
    const pid = person.person_id;
    let totalPrefHours = 0;
    for (const pref of raw.partner_preferences) {
      if (pref.person_id === pid && pref.pref_ideal_hours > 0) {
        totalPrefHours += pref.pref_ideal_hours;
      }
    }
    if (totalPrefHours <= 0) continue;
    const terms: LpTerm[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cand = candidates[ci]!;
      if (cand.participantIds.length === 2 && cand.participantIds.includes(pid)) {
        terms.push({ coef: cand.durationHours, varName: `x${ci}` });
      }
    }
    if (terms.length === 0) continue;
    terms.push({ coef: -totalPrefHours, varName: 'z' });
    addRow(terms, '>=', 0);
  }

  // CONSTRAINT 3b: Per-pair maximin.
  for (const pref of raw.partner_preferences) {
    if (pref.pref_ideal_hours <= 0) continue;
    const key = participantKeyOf([pref.person_id, pref.partner_id]);
    const terms: LpTerm[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cand = candidates[ci]!;
      if (cand.participantKey === key && cand.participantIds.length === 2) {
        terms.push({ coef: cand.durationHours, varName: `x${ci}` });
      }
    }
    if (terms.length === 0) continue;
    terms.push({ coef: -pref.pref_ideal_hours, varName: 'z_pair' });
    addRow(terms, '>=', 0);
  }

  // CONSTRAINT 5: Per-pair overshoot cap.
  const pairPrefMax = new Map<string, number>();
  for (const pref of raw.partner_preferences) {
    if (pref.pref_ideal_hours <= 0) continue;
    const key = participantKeyOf([pref.person_id, pref.partner_id]);
    pairPrefMax.set(key, Math.max(pairPrefMax.get(key) ?? 0, pref.pref_ideal_hours));
  }
  for (const [key, ideal] of pairPrefMax) {
    const terms: LpTerm[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cand = candidates[ci]!;
      if (cand.participantKey === key && cand.participantIds.length === 2) {
        terms.push({ coef: cand.durationHours, varName: `x${ci}` });
      }
    }
    if (terms.length === 0) continue;
    addRow(terms, '<=', ideal * OVERSHOOT_FACTOR);
  }

  // CONSTRAINT 6: Pod-gathering frequency cap.
  for (const gathering of raw.pod_gatherings) {
    if (gathering.frequency <= 0) continue;
    const terms: LpTerm[] = [];
    for (let ci = 0; ci < n; ci++) {
      if (candidates[ci]!.podId === gathering.pod_id) {
        terms.push({ coef: 1, varName: `x${ci}` });
      }
    }
    if (terms.length === 0) continue;
    addRow(terms, '<=', gathering.frequency);
  }

  // Sub-group frequency cap.
  for (const sub of raw.subgroup_prefs) {
    if (sub.frequency <= 0) continue;
    const subKey = participantKeyOf(sub.member_ids);
    const terms: LpTerm[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cand = candidates[ci]!;
      if (cand.participantKey === subKey && cand.podId === null) {
        terms.push({ coef: 1, varName: `x${ci}` });
      }
    }
    if (terms.length === 0) continue;
    addRow(terms, '<=', sub.frequency);
  }

  // CONSTRAINT 4: Solo / rest evenings.
  for (const person of raw.persons) {
    if (person.solo_min_free_evenings <= 0) continue;
    const eveningCands: number[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cand = candidates[ci]!;
      if (
        cand.participantIds.includes(person.person_id) &&
        isEveningSlot(cand, prepared.horizonStart, prepared.slotMinutes)
      ) {
        eveningCands.push(ci);
      }
    }
    if (eveningCands.length === 0) continue;
    const weeksInHorizon = Math.max(1.0, prepared.horizonSeconds / 86400 / 7);
    const totalEvenings = Math.trunc(weeksInHorizon * 7);
    const maxScheduledEvenings = Math.max(
      0,
      totalEvenings - Math.trunc(person.solo_min_free_evenings * weeksInHorizon),
    );
    addRow(
      eveningCands.map((ci) => ({ coef: 1, varName: `x${ci}` })),
      '<=',
      maxScheduledEvenings,
    );
  }

  // ── Bounds ───────────────────────────────────────────────────────────
  lines.push('Bounds');
  lines.push('  0 <= z <= 1');
  lines.push('  0 <= z_pair <= 1');
  // Binary vars take their bounds from the Binary section below; explicit
  // 0..1 bounds are redundant but harmless and make the LP self-documenting
  // when written out. We omit them here to keep the LP small.

  // ── Binary ───────────────────────────────────────────────────────────
  if (n > 0) {
    lines.push('Binary');
    // Group binary var names; 8 per line for readability.
    for (let i = 0; i < n; i += 8) {
      const slice: string[] = [];
      for (let j = i; j < Math.min(i + 8, n); j++) slice.push(`x${j}`);
      lines.push(`  ${slice.join(' ')}`);
    }
  }

  lines.push('End');
  return lines.join('\n');
}

// ── Helpers (port of solver.py helpers) ─────────────────────────────────

function isEveningSlot(cand: CandidateSlot, horizonStart: Date, slotMinutes: number): boolean {
  const slotStart = new Date(horizonStart.getTime() + cand.startSlot * slotMinutes * 60_000);
  // Compare in UTC hours, matching the Python implementation which uses
  // naive datetime arithmetic on a UTC-anchored horizon.
  const hour = slotStart.getUTCHours();
  return hour >= 18 && hour < 23;
}

function buildInfeasibilityNotes(
  request: OptimizationRequest,
  _status: string,
): string[] {
  const notes: string[] = [
    'Could not find a feasible schedule. Some needs may exceed available overlapping free time.',
  ];
  for (const person of request.persons) {
    const personPrefs = request.partner_preferences.filter(
      (p) => p.person_id === person.person_id,
    );
    const totalNeed = personPrefs.reduce((sum, p) => sum + p.need_min_hours, 0);
    const freeHours = sumWindowMinutes(person.free_windows) / 60;
    if (totalNeed > freeHours) {
      notes.push(
        `Person ${person.person_id}: stated minimums total ${totalNeed.toFixed(1)}h but only ${freeHours.toFixed(1)}h of free time available.`,
      );
    }
  }
  return notes;
}

function sumWindowMinutes(windows: Array<{ start: string; end: string }>): number {
  let total = 0;
  for (const w of windows) {
    total += (new Date(w.end).getTime() - new Date(w.start).getTime()) / 60_000;
  }
  return total;
}

function computeSatisfaction(
  blocks: ProposedBlock[],
  request: OptimizationRequest,
): SatisfactionReport[] {
  const out: SatisfactionReport[] = [];
  for (const person of request.persons) {
    const pid = person.person_id;
    const perPartner: SatisfactionReport['per_partner'] = {};
    const unmetNeeds: string[] = [];

    for (const pref of request.partner_preferences) {
      if (pref.person_id !== pid) continue;
      const pairKey = participantKeyOf([pid, pref.partner_id]);
      let pairHours = 0;
      for (const b of blocks) {
        if (participantKeyOf(b.participant_ids) === pairKey) {
          pairHours += b.satisfaction_contribution[pid] ?? 0;
        }
      }
      const needMet = pairHours + 1e-6 >= pref.need_min_hours;
      const prefPct =
        pref.pref_ideal_hours > 0
          ? Math.min(100, (pairHours / pref.pref_ideal_hours) * 100)
          : 100;

      perPartner[pref.partner_id] = {
        need_met: needMet,
        pref_pct: round1(prefPct),
        hours_scheduled: round2(pairHours),
        hours_wanted: pref.pref_ideal_hours,
      };

      if (!needMet) {
        unmetNeeds.push(
          `Minimum ${pref.need_min_hours}h with partner ${pref.partner_id} not met (got ${pairHours.toFixed(1)}h)`,
        );
      }
    }

    let totalHours = 0;
    let totalWanted = 0;
    for (const data of Object.values(perPartner)) {
      totalHours += data.hours_scheduled;
      totalWanted += data.hours_wanted;
    }
    const overallPct = totalWanted > 0 ? Math.min(100, (totalHours / totalWanted) * 100) : 100;

    out.push({
      person_id: pid,
      overall_pct: round1(overallPct),
      per_partner: perPartner,
      unmet_needs: unmetNeeds,
    });
  }
  return out;
}

function emptyScores(
  request: OptimizationRequest,
  _notes: string[],
): SatisfactionReport[] {
  const msg = 'No schedule could be generated.';
  const out: SatisfactionReport[] = [];
  for (const person of request.persons) {
    const perPartner: SatisfactionReport['per_partner'] = {};
    const unmet: string[] = [];
    for (const pref of request.partner_preferences) {
      if (pref.person_id !== person.person_id) continue;
      perPartner[pref.partner_id] = {
        need_met: pref.need_min_hours <= 0,
        pref_pct: pref.pref_ideal_hours <= 0 ? 100 : 0,
        hours_scheduled: 0,
        hours_wanted: pref.pref_ideal_hours,
      };
      if (pref.need_min_hours > 0) {
        unmet.push(
          `Minimum ${pref.need_min_hours}h with partner ${pref.partner_id} not met (got 0.0h)`,
        );
      }
    }
    if (unmet.length === 0) unmet.push(msg);
    out.push({
      person_id: person.person_id,
      overall_pct: 0,
      per_partner: perPartner,
      unmet_needs: unmet,
    });
  }
  return out;
}

export function analyzeGaps(
  scores: SatisfactionReport[],
  request: OptimizationRequest,
): string[] {
  const insights: string[] = [];
  const personById = new Map<string, OptimizerPersonSpec>();
  for (const p of request.persons) personById.set(p.person_id, p);

  for (const score of scores) {
    if (score.overall_pct >= 90) continue;
    const personSpec = personById.get(score.person_id);
    if (!personSpec) continue;

    const personPrefs = request.partner_preferences.filter(
      (p) => p.person_id === score.person_id,
    );
    const totalDesired = personPrefs.reduce((s, p) => s + p.pref_ideal_hours, 0);
    const totalFreeHours = sumWindowMinutes(personSpec.free_windows) / 60;

    if (totalDesired > totalFreeHours * 0.8 && totalDesired > 0) {
      insights.push(
        `Person ${score.person_id}: desired time (${totalDesired.toFixed(0)}h) is close to total free time (${totalFreeHours.toFixed(0)}h). Consider reducing preferences or freeing up calendar space.`,
      );
    }

    for (const [partnerId, data] of Object.entries(score.per_partner)) {
      if (data.need_met) continue;
      const partnerSpec = personById.get(partnerId);
      if (!partnerSpec) continue;
      const shared = countSharedHours(personSpec, partnerSpec);
      insights.push(
        `Person ${score.person_id} and partner ${partnerId} share only ${shared.toFixed(0)}h of overlapping free time, but need ${data.hours_wanted}h.`,
      );
    }
  }
  return insights;
}

function countSharedHours(a: OptimizerPersonSpec, b: OptimizerPersonSpec): number {
  let totalMin = 0;
  for (const wa of a.free_windows) {
    const aStart = new Date(wa.start).getTime();
    const aEnd = new Date(wa.end).getTime();
    for (const wb of b.free_windows) {
      const bStart = new Date(wb.start).getTime();
      const bEnd = new Date(wb.end).getTime();
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (end > start) totalMin += (end - start) / 60_000;
    }
  }
  return totalMin / 60;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
