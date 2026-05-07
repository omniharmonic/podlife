"""MILP solver for Pod Life schedule optimization.

The model:
    Decision variables:
      x[i] ∈ {0,1}  for each candidate slot i
      z         ∈ [0,1]  primary maximin: min satisfaction across all people
      z_pair    ∈ [0,1]  secondary maximin: min satisfaction across each
                          (person, partner) PAIR — addresses STRESS_TEST_REPORT
                          finding L2, where overall=100% can mask uneven
                          per-partner allocation.

    Objective (lexicographic, encoded with small ε weights):
        maximize  z                                  (primary)
                + ε_pair · z_pair                     (per-pair fairness)
                + ε_pod · (count of pod-gathering+subgroup blocks selected)
        as:       minimize  -z - ε_pair·z_pair - ε_pod·(Σ pod-bonus x[i])

      ε's are small enough that any 1% movement in z dominates them.

    Constraint 1 (no double-booking):
      For every (slot, person) pair, the number of selected candidates
      that involve that person at that slot is ≤ 1.

    Constraint 2 (hard minimums):
      For every partner pair with need_min_hours > 0, the total scheduled
      hours for that pair is ≥ need_min_hours.

    Constraint 3 (maximin fairness, per-person):
      For every person p with positive total preferred hours,
        sum(hours_for_p) - total_pref_hours_p · z ≥ 0
      so z is upper-bounded by every person's individual satisfaction ratio.

    Constraint 3b (maximin fairness, per-pair — addresses L2):
      For every (person, partner) preference with pref_ideal_hours > 0,
        sum(pair_hours) - pref_ideal_hours · z_pair ≥ 0

    Constraint 4 (solo / rest evenings):
      For every person with solo_min_free_evenings > 0, the count of selected
      evening candidates is ≤ total_evenings - required_free_evenings.

    Constraint 5 (per-pair overshoot cap — addresses L5):
      For every (person, partner) preference with pref_ideal_hours > 0,
        sum(pair_hours) ≤ pref_ideal_hours · OVERSHOOT_FACTOR
      Prevents the solver from massively overshooting one partner just
      because they have lots of overlap.

See pod-life-technical-architecture.md § 7.2 and § 16.1.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any

import highspy
import numpy as np

from .models import (
    OptimizationRequest,
    OptimizationResponse,
    ProposedBlock,
    SatisfactionScore,
)
from .slot_discovery import CandidateSlot, discover_candidate_slots

logger = logging.getLogger(__name__)

SOLVER_TIME_LIMIT_SECONDS = 5.0

# Lexicographic weights — small enough that any 1% movement of `z` (worth 0.01
# in the negative-z objective) dominates them. Pod-gathering bonus is per
# selected pod/subgroup block.
EPSILON_PAIR_FAIRNESS = 1e-3
# A pod-gathering bonus of 5e-4 was too small to overcome solver tie-breaking;
# 0.01 is the largest that still lets a 1% movement of `z` dominate. With
# Constraint 6 hard-capping pod blocks at the requested frequency, this
# bonus simply gets the solver to fill the requested count when feasible.
EPSILON_POD_BONUS = 1e-2

# Per-pair overshoot cap. Schedule no more than 1.5× the stated ideal —
# prevents the surplus-allocation drift from STRESS_TEST_REPORT L5.
OVERSHOOT_FACTOR = 1.5


def solve(request: OptimizationRequest) -> OptimizationResponse:
    """Run the MILP solver and return a complete OptimizationResponse.

    Infeasibility is a normal outcome (e.g. when stated needs exceed available
    overlap). On infeasibility we return an empty proposal list with a populated
    `infeasibility_notes`, never an exception.
    """
    start_time = time.time()
    slot_minutes = request.slot_duration_minutes
    horizon_seconds = (request.horizon_end - request.horizon_start).total_seconds()
    horizon_slots = int(horizon_seconds / 60 / slot_minutes)

    # ── PHASE 1: Discover candidate slots ─────────────────────────────────
    candidates = discover_candidate_slots(request, horizon_slots)

    if not candidates:
        notes = ["No overlapping free time found for any pair."]
        notes.extend(analyze_gaps(_empty_scores(request, notes), request))
        return OptimizationResponse(
            proposed_blocks=[],
            satisfaction_scores=_empty_scores(request, notes),
            infeasibility_notes=notes,
            solver_time_ms=int((time.time() - start_time) * 1000),
            slot_count=horizon_slots,
            variable_count=0,
        )

    # ── PHASE 2: Build the MILP ───────────────────────────────────────────
    h = highspy.Highs()
    h.silent()
    h.setOptionValue("time_limit", SOLVER_TIME_LIMIT_SECONDS)

    num_candidates = len(candidates)
    # x[0..num_candidates-1] | z (person maximin) | z_pair (per-pair maximin)
    num_vars = num_candidates + 2
    z_idx = num_candidates
    z_pair_idx = num_candidates + 1

    col_lower = np.zeros(num_vars, dtype=np.float64)
    col_upper = np.ones(num_vars, dtype=np.float64)

    h.addVars(num_vars, col_lower, col_upper)

    # Mark the candidate columns as integer (binary because bounds are [0,1]).
    # z and z_pair stay continuous.
    for i in range(num_candidates):
        h.changeColIntegrality(i, highspy.HighsVarType.kInteger)

    # Objective (minimize): -z - ε_pair·z_pair - ε_pod·Σ(pod/subgroup x)
    for i in range(num_candidates):
        # Bonus for pod-gathering and subgroup candidates (addresses L1).
        is_pod_block = candidates[i].pod_id is not None or len(
            candidates[i].participant_ids
        ) >= 3
        h.changeColCost(i, -EPSILON_POD_BONUS if is_pod_block else 0.0)
    h.changeColCost(z_idx, -1.0)
    h.changeColCost(z_pair_idx, -EPSILON_PAIR_FAIRNESS)
    h.changeObjectiveSense(highspy.ObjSense.kMinimize)

    # ── CONSTRAINT 1: No person double-booked ────────────────────────────
    # For each (slot, person) pair touched by ≥ 2 candidates, sum ≤ 1.
    slot_person_map: dict[tuple[int, str], list[int]] = {}
    for ci, cand in enumerate(candidates):
        for slot in range(cand.start_slot, cand.end_slot):
            for pid in cand.participant_ids:
                key = (slot, pid)
                slot_person_map.setdefault(key, []).append(ci)

    for cand_indices in slot_person_map.values():
        if len(cand_indices) > 1:
            row_idx = np.asarray(cand_indices, dtype=np.int32)
            row_vals = np.ones(len(cand_indices), dtype=np.float64)
            h.addRow(0.0, 1.0, len(row_idx), row_idx, row_vals)

    # ── CONSTRAINT 2: Hard minimums per partner pair ─────────────────────
    # We OR-aggregate need_min_hours from both directions of a partnership;
    # the binding constraint is the larger of the two sides.
    pair_need_hours: dict[frozenset[str], float] = {}
    for pref in request.partner_preferences:
        if pref.need_min_hours <= 0:
            continue
        pair = frozenset([pref.person_id, pref.partner_id])
        pair_need_hours[pair] = max(pair_need_hours.get(pair, 0.0), pref.need_min_hours)

    for pair, need_hours in pair_need_hours.items():
        relevant = [
            (ci, cand)
            for ci, cand in enumerate(candidates)
            if cand.participant_ids == pair
        ]
        if not relevant:
            continue
        row_idx = np.asarray([ci for ci, _ in relevant], dtype=np.int32)
        row_vals = np.asarray([cand.duration_hours for _, cand in relevant], dtype=np.float64)
        h.addRow(need_hours, highspy.kHighsInf, len(row_idx), row_idx, row_vals)

    # ── CONSTRAINT 3: Maximin fairness (pair-only) ───────────────────────
    # For every person p with positive total stated preference,
    #   sum(pair-only hours for p) - total_pref_hours_p · z ≥ 0
    # Pod gatherings + sub-groups are scheduled via Constraint 6 (their own
    # frequency target) and bonused via ε_POD; they do NOT count toward the
    # per-pair maximin or per-person `pref_ideal_hours` satisfaction. This
    # keeps "I want 5h with B" meaning intimate pair time, not group time.
    for person in request.persons:
        pid = person.person_id
        total_pref_hours = sum(
            pref.pref_ideal_hours
            for pref in request.partner_preferences
            if pref.person_id == pid and pref.pref_ideal_hours > 0
        )
        if total_pref_hours <= 0:
            continue
        relevant = [
            (ci, cand)
            for ci, cand in enumerate(candidates)
            if pid in cand.participant_ids and len(cand.participant_ids) == 2
        ]
        if not relevant:
            continue
        row_idx = np.asarray(
            [ci for ci, _ in relevant] + [z_idx], dtype=np.int32
        )
        row_vals = np.asarray(
            [cand.duration_hours for _, cand in relevant] + [-float(total_pref_hours)],
            dtype=np.float64,
        )
        h.addRow(0.0, highspy.kHighsInf, len(row_idx), row_idx, row_vals)

    # ── CONSTRAINT 3b: Per-pair maximin (addresses L2) ──────────────────
    # For every (person, partner) preference with positive ideal hours,
    #   sum(pair-only hours) - pref_ideal_hours · z_pair ≥ 0
    # We deliberately use pair-only blocks (not subset semantics): the goal
    # is to balance INTIMATE pair time. Pod-gathering hours count toward
    # each person's overall-time (Constraint 3), but per-pair fairness
    # is about how much one-on-one time each partner gets.
    for pref in request.partner_preferences:
        if pref.pref_ideal_hours <= 0:
            continue
        pair = frozenset([pref.person_id, pref.partner_id])
        relevant = [
            (ci, cand)
            for ci, cand in enumerate(candidates)
            if cand.participant_ids == pair
        ]
        if not relevant:
            continue
        row_idx = np.asarray(
            [ci for ci, _ in relevant] + [z_pair_idx], dtype=np.int32
        )
        row_vals = np.asarray(
            [cand.duration_hours for _, cand in relevant]
            + [-float(pref.pref_ideal_hours)],
            dtype=np.float64,
        )
        h.addRow(0.0, highspy.kHighsInf, len(row_idx), row_idx, row_vals)

    # ── CONSTRAINT 5: Per-pair overshoot cap (addresses L5) ──────────────
    # Schedule at most OVERSHOOT_FACTOR × pref_ideal_hours per pair so the
    # solver doesn't drift surplus time onto whichever partner has the most
    # overlap. We aggregate both directions of a partnership to a single cap.
    pair_pref_max: dict[frozenset[str], float] = {}
    for pref in request.partner_preferences:
        if pref.pref_ideal_hours <= 0:
            continue
        pair = frozenset([pref.person_id, pref.partner_id])
        # Use the larger side's stated ideal as the basis.
        pair_pref_max[pair] = max(pair_pref_max.get(pair, 0.0), pref.pref_ideal_hours)

    for pair, ideal in pair_pref_max.items():
        # Cap counts pair-only blocks; pod/group blocks are unrestricted.
        # The cap is meant to prevent surplus pair-time drift, not to limit
        # how often the pod meets together.
        relevant = [
            (ci, cand)
            for ci, cand in enumerate(candidates)
            if cand.participant_ids == pair
        ]
        if not relevant:
            continue
        cap = ideal * OVERSHOOT_FACTOR
        row_idx = np.asarray([ci for ci, _ in relevant], dtype=np.int32)
        row_vals = np.asarray(
            [cand.duration_hours for _, cand in relevant], dtype=np.float64
        )
        h.addRow(0.0, float(cap), len(row_idx), row_idx, row_vals)

    # ── CONSTRAINT 6: Pod-gathering frequency cap ────────────────────────
    # Each pod_gathering pref says "we'd like N gatherings per cycle".
    # Without a cap the ε bonus + (formerly) generous person-maximin counted
    # pod blocks too liberally, so we'd schedule one every available slot.
    # Cap pod-gathering blocks at the requested frequency per pod.
    for gathering in request.pod_gatherings:
        if gathering.frequency <= 0:
            continue
        pod_indices = [
            ci
            for ci, cand in enumerate(candidates)
            if cand.pod_id == gathering.pod_id
        ]
        if not pod_indices:
            continue
        row_idx = np.asarray(pod_indices, dtype=np.int32)
        row_vals = np.ones(len(pod_indices), dtype=np.float64)
        h.addRow(0.0, float(gathering.frequency), len(row_idx), row_idx, row_vals)

    # Sub-group frequency cap (same logic).
    for sub in request.subgroup_prefs:
        if sub.frequency <= 0:
            continue
        sub_set = frozenset(sub.member_ids)
        sub_indices = [
            ci
            for ci, cand in enumerate(candidates)
            if cand.participant_ids == sub_set and cand.pod_id is None
        ]
        if not sub_indices:
            continue
        row_idx = np.asarray(sub_indices, dtype=np.int32)
        row_vals = np.ones(len(sub_indices), dtype=np.float64)
        h.addRow(0.0, float(sub.frequency), len(row_idx), row_idx, row_vals)

    # ── CONSTRAINT 4: Solo / rest evenings ───────────────────────────────
    # Limit how many evening candidates a person can be scheduled into so
    # they retain the requested number of free evenings each week.
    for person in request.persons:
        if person.solo_min_free_evenings <= 0:
            continue
        evening_candidates = [
            ci
            for ci, cand in enumerate(candidates)
            if person.person_id in cand.participant_ids
            and _is_evening_slot(cand, request.horizon_start, slot_minutes)
        ]
        if not evening_candidates:
            continue
        weeks_in_horizon = max(1.0, horizon_seconds / 86400.0 / 7.0)
        total_evenings = int(weeks_in_horizon * 7)
        max_scheduled_evenings = max(
            0, total_evenings - int(person.solo_min_free_evenings * weeks_in_horizon)
        )
        row_idx = np.asarray(evening_candidates, dtype=np.int32)
        row_vals = np.ones(len(evening_candidates), dtype=np.float64)
        h.addRow(0.0, float(max_scheduled_evenings), len(row_idx), row_idx, row_vals)

    # ── SOLVE ────────────────────────────────────────────────────────────
    h.run()
    solver_time_ms = int((time.time() - start_time) * 1000)
    model_status = h.getModelStatus()

    # Optimal or feasible-but-time-limited both yield a usable solution.
    feasible_statuses = {
        highspy.HighsModelStatus.kOptimal,
        highspy.HighsModelStatus.kTimeLimit,
        highspy.HighsModelStatus.kSolutionLimit,
    }

    if model_status not in feasible_statuses:
        notes = _build_infeasibility_notes(request, model_status)
        empty_scores = _empty_scores(request, notes)
        notes.extend(analyze_gaps(empty_scores, request))
        return OptimizationResponse(
            proposed_blocks=[],
            satisfaction_scores=empty_scores,
            infeasibility_notes=notes,
            solver_time_ms=solver_time_ms,
            slot_count=horizon_slots,
            variable_count=num_vars,
        )

    solution = h.getSolution()
    col_values = list(solution.col_value)

    # When time-limited, HiGHS may return a partial / no incumbent solution.
    # Verify we actually got numeric values back before extracting.
    if not col_values or len(col_values) < num_vars:
        notes = ["Solver returned no incumbent solution within time limit."]
        empty_scores = _empty_scores(request, notes)
        return OptimizationResponse(
            proposed_blocks=[],
            satisfaction_scores=empty_scores,
            infeasibility_notes=notes,
            solver_time_ms=solver_time_ms,
            slot_count=horizon_slots,
            variable_count=num_vars,
        )

    # ── EXTRACT SOLUTION ─────────────────────────────────────────────────
    proposed_blocks: list[ProposedBlock] = []
    for ci, cand in enumerate(candidates):
        if col_values[ci] > 0.5:
            block_start = request.horizon_start + timedelta(
                minutes=cand.start_slot * slot_minutes
            )
            block_end = request.horizon_start + timedelta(
                minutes=cand.end_slot * slot_minutes
            )
            contribution = {pid: cand.duration_hours for pid in cand.participant_ids}
            proposed_blocks.append(
                ProposedBlock(
                    event_type=cand.event_type,
                    start=block_start,
                    end=block_end,
                    participant_ids=list(cand.participant_ids),
                    partnership_id=cand.partnership_id,
                    pod_id=cand.pod_id,
                    satisfaction_contribution=contribution,
                )
            )

    satisfaction_scores = _compute_satisfaction(proposed_blocks, request)
    gap_notes = analyze_gaps(satisfaction_scores, request)

    logger.info(
        "solve complete: vars=%d cands=%d blocks=%d ms=%d status=%s",
        num_vars,
        num_candidates,
        len(proposed_blocks),
        solver_time_ms,
        model_status,
    )

    return OptimizationResponse(
        proposed_blocks=proposed_blocks,
        satisfaction_scores=satisfaction_scores,
        infeasibility_notes=gap_notes,
        solver_time_ms=solver_time_ms,
        slot_count=horizon_slots,
        variable_count=num_vars,
    )


# ── Helpers ─────────────────────────────────────────────────────────────


def _is_evening_slot(
    cand: CandidateSlot, horizon_start: datetime, slot_minutes: int
) -> bool:
    """Return True if the candidate's start hour falls in 18:00–22:59."""
    slot_start = horizon_start + timedelta(minutes=cand.start_slot * slot_minutes)
    return 18 <= slot_start.hour < 23


def _build_infeasibility_notes(
    request: OptimizationRequest, model_status: Any
) -> list[str]:
    notes: list[str] = []
    notes.append(
        "Could not find a feasible schedule. "
        "Some needs may exceed available overlapping free time."
    )
    # Quick oversubscription scan for friendlier diagnostics.
    for person in request.persons:
        pid = person.person_id
        person_prefs = [
            p for p in request.partner_preferences if p.person_id == pid
        ]
        total_need = sum(p.need_min_hours for p in person_prefs)
        free_hours = sum(w.duration_minutes for w in person.free_windows) / 60.0
        if total_need > free_hours:
            notes.append(
                f"Person {pid}: stated minimums total {total_need:.1f}h but only "
                f"{free_hours:.1f}h of free time available."
            )
    return notes


def _compute_satisfaction(
    blocks: list[ProposedBlock], request: OptimizationRequest
) -> list[SatisfactionScore]:
    """Per-person satisfaction breakdown — see § 7.2 _compute_satisfaction."""
    scores: list[SatisfactionScore] = []

    for person in request.persons:
        pid = person.person_id
        per_partner: dict[str, dict[str, Any]] = {}
        unmet_needs: list[str] = []

        for pref in request.partner_preferences:
            if pref.person_id != pid:
                continue
            pair = frozenset([pid, pref.partner_id])
            # Per-pair satisfaction tracks INTIMATE pair time only — time
            # spent one-on-one with this partner. Pod-gathering hours show
            # up separately in the person's overall_pct (which uses
            # subset semantics in the solver's Constraint 3 person maximin).
            pair_hours = sum(
                b.satisfaction_contribution.get(pid, 0.0)
                for b in blocks
                if frozenset(b.participant_ids) == pair
            )
            need_met = pair_hours + 1e-6 >= pref.need_min_hours
            if pref.pref_ideal_hours > 0:
                pref_pct = min(100.0, (pair_hours / pref.pref_ideal_hours) * 100.0)
            else:
                pref_pct = 100.0

            per_partner[pref.partner_id] = {
                "need_met": need_met,
                "pref_pct": round(pref_pct, 1),
                "hours_scheduled": round(pair_hours, 2),
                "hours_wanted": pref.pref_ideal_hours,
            }

            if not need_met:
                unmet_needs.append(
                    f"Minimum {pref.need_min_hours}h with partner "
                    f"{pref.partner_id} not met (got {pair_hours:.1f}h)"
                )

        # Overall = pair-only hours / sum of pair-ideal hours. This matches
        # the solver's Constraint 3 (per-person maximin) which only counts
        # 2-person blocks. Pod-gathering attendance is a separate axis,
        # tracked via the pod's `frequency` target rather than hours.
        total_hours = sum(d["hours_scheduled"] for d in per_partner.values())
        total_wanted = sum(d["hours_wanted"] for d in per_partner.values())
        if total_wanted > 0:
            overall_pct = min(100.0, (total_hours / total_wanted) * 100.0)
        else:
            # No preferences stated → person is satisfied by default.
            overall_pct = 100.0

        scores.append(
            SatisfactionScore(
                person_id=pid,
                overall_pct=round(overall_pct, 1),
                per_partner=per_partner,
                unmet_needs=unmet_needs,
            )
        )
    return scores


def _empty_scores(
    request: OptimizationRequest, notes: list[str] | None = None
) -> list[SatisfactionScore]:
    """Empty scores for the infeasible case.

    Addresses STRESS_TEST_REPORT L3: even when no blocks were scheduled, the
    per_partner breakdown should be populated so the frontend can render
    "all needs unmet" uniformly.
    """
    msg = "No schedule could be generated."
    scores: list[SatisfactionScore] = []
    for person in request.persons:
        per_partner: dict[str, dict[str, Any]] = {}
        unmet: list[str] = []
        for pref in request.partner_preferences:
            if pref.person_id != person.person_id:
                continue
            per_partner[pref.partner_id] = {
                "need_met": pref.need_min_hours <= 0,
                "pref_pct": 100.0 if pref.pref_ideal_hours <= 0 else 0.0,
                "hours_scheduled": 0.0,
                "hours_wanted": pref.pref_ideal_hours,
            }
            if pref.need_min_hours > 0:
                unmet.append(
                    f"Minimum {pref.need_min_hours}h with partner "
                    f"{pref.partner_id} not met (got 0.0h)"
                )
        if not unmet:
            unmet.append(msg)
        scores.append(
            SatisfactionScore(
                person_id=person.person_id,
                overall_pct=0.0,
                per_partner=per_partner,
                unmet_needs=unmet,
            )
        )
    return scores


def analyze_gaps(
    scores: list[SatisfactionScore], request: OptimizationRequest
) -> list[str]:
    """Generate human-readable explanations for unmet needs (§ 16.3)."""
    insights: list[str] = []
    person_by_id = {p.person_id: p for p in request.persons}

    for score in scores:
        if score.overall_pct >= 90:
            continue

        pid = score.person_id
        person_spec = person_by_id.get(pid)
        if person_spec is None:
            continue

        person_prefs = [
            p for p in request.partner_preferences if p.person_id == pid
        ]
        total_desired = sum(p.pref_ideal_hours for p in person_prefs)
        total_free_hours = (
            sum(w.duration_minutes for w in person_spec.free_windows) / 60.0
        )

        if total_desired > total_free_hours * 0.8 and total_desired > 0:
            insights.append(
                f"Person {pid}: desired time ({total_desired:.0f}h) is close to "
                f"total free time ({total_free_hours:.0f}h). "
                "Consider reducing preferences or freeing up calendar space."
            )

        for partner_id, data in score.per_partner.items():
            if data.get("need_met", True):
                continue
            partner_spec = person_by_id.get(partner_id)
            if partner_spec is None:
                continue
            shared = _count_shared_hours(person_spec, partner_spec)
            insights.append(
                f"Person {pid} and partner {partner_id} share only {shared:.0f}h "
                f"of overlapping free time, but need {data.get('hours_wanted', '?')}h."
            )

    return insights


def _count_shared_hours(person_a: Any, person_b: Any) -> float:
    """Approximate overlapping free hours between two persons (no slot discretization)."""
    total_minutes = 0.0
    for wa in person_a.free_windows:
        for wb in person_b.free_windows:
            start = max(wa.start, wb.start)
            end = min(wa.end, wb.end)
            if end > start:
                total_minutes += (end - start).total_seconds() / 60.0
    return total_minutes / 60.0
