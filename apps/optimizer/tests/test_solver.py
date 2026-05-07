"""Integration tests for the MILP solver across all polycule fixtures."""

from __future__ import annotations

import time
from datetime import timedelta

from src.models import OptimizationRequest
from src.solver import solve

from .fixtures.polycule_configs import (
    HORIZON_START,
    evening_windows,
    multi_pod_conflict,
    oversubscribed,
    timezone_mismatch,
    triad_basic,
    v_structure,
)


def _build(config: dict) -> OptimizationRequest:
    return OptimizationRequest.model_validate(config)


def _hours_for_pair(blocks, a: str, b: str) -> float:
    pair = frozenset({a, b})
    return sum(
        b_.satisfaction_contribution.get(a, 0.0)
        for b_ in blocks
        if frozenset(b_.participant_ids) == pair
    )


def test_triad_basic_all_three_get_time() -> None:
    req = _build(triad_basic())
    resp = solve(req)

    assert resp.proposed_blocks, "triad_basic must produce at least one block"
    # Every person should appear in at least one block.
    persons_seen = set()
    for b in resp.proposed_blocks:
        persons_seen.update(b.participant_ids)
    assert persons_seen == {"A", "B", "C"}

    # Satisfaction should be non-trivial for all three.
    for s in resp.satisfaction_scores:
        assert s.overall_pct > 30, f"{s.person_id} got only {s.overall_pct}%"

    assert resp.solver_time_ms < 2000


def test_v_structure_a_time_split_between_b_and_c() -> None:
    req = _build(v_structure())
    resp = solve(req)

    assert resp.proposed_blocks
    ab_hours = _hours_for_pair(resp.proposed_blocks, "A", "B")
    ac_hours = _hours_for_pair(resp.proposed_blocks, "A", "C")

    # Both partnerships' hard minimums must be satisfied.
    assert ab_hours >= 6.0 - 1e-6, f"A↔B got only {ab_hours}h, need 6"
    assert ac_hours >= 4.0 - 1e-6, f"A↔C got only {ac_hours}h, need 4"

    # A's free time has been split between the two partners.
    assert ab_hours > 0 and ac_hours > 0

    # No "B↔C" blocks (B and C aren't partners).
    bc_pair = frozenset({"B", "C"})
    assert not any(
        frozenset(b.participant_ids) == bc_pair for b in resp.proposed_blocks
    )


def test_multi_pod_conflict_splits_a_between_b_and_c() -> None:
    """A has 4 evenings (~20h) shared with each of B and C. Both 5h minimums
    are achievable; the solver should respect them and split A's time between
    the two partnerships without double-booking A in any slot."""
    req = _build(multi_pod_conflict())
    resp = solve(req)

    assert resp.proposed_blocks
    ab_hours = _hours_for_pair(resp.proposed_blocks, "A", "B")
    ac_hours = _hours_for_pair(resp.proposed_blocks, "A", "C")
    # Both hard minimums must be met.
    assert ab_hours >= 5.0 - 1e-6, f"A↔B got only {ab_hours}h"
    assert ac_hours >= 5.0 - 1e-6, f"A↔C got only {ac_hours}h"

    # No slot may have A in both an A↔B and an A↔C block simultaneously.
    a_blocks = [b for b in resp.proposed_blocks if "A" in b.participant_ids]
    for i, b1 in enumerate(a_blocks):
        for b2 in a_blocks[i + 1 :]:
            overlap = max(b1.start, b2.start) < min(b1.end, b2.end)
            assert not overlap, f"A double-booked: {b1.start}–{b1.end} & {b2.start}–{b2.end}"


def test_multi_pod_conflict_infeasible_when_demand_exceeds_supply() -> None:
    """If we crank B's and C's needs beyond what A's 4 evenings can supply,
    the solver should report infeasibility with diagnostic notes."""
    config = multi_pod_conflict()
    # A has 4 evenings × 5h = 20h. Demand 12 + 12 = 24h is impossible without
    # double-booking A. (Slot exclusion makes 24h require ≥ 24h of A's time.)
    for pref in config["partner_preferences"]:
        if pref["person_id"] in ("B", "C") and pref["partner_id"] == "A":
            pref["need_min_hours"] = 12
            pref["pref_ideal_hours"] = 12
    req = _build(config)
    resp = solve(req)
    # Either no blocks at all, or some need flagged as unmet.
    if resp.proposed_blocks:
        # If it returned a partial schedule, at least one need must be unmet.
        assert any(s.unmet_needs for s in resp.satisfaction_scores)
    else:
        assert resp.infeasibility_notes


def test_oversubscribed_maximin_fairness() -> None:
    """A has 4 partners each wanting 8h; total demand 32h, supply ~20h.
    Maximin should distribute roughly evenly — no winner-take-all."""
    req = _build(oversubscribed())
    resp = solve(req)

    assert resp.proposed_blocks
    pair_hours = {
        f"P{i}": _hours_for_pair(resp.proposed_blocks, "A", f"P{i}")
        for i in range(1, 5)
    }
    # Every partner got at least the 2h minimum.
    for partner, hrs in pair_hours.items():
        assert hrs >= 2.0 - 1e-6, f"{partner} got only {hrs}h, need 2"

    # Equal-ish split: max should not exceed min by more than ~3h
    # (one extra date-night-sized block of slack is OK).
    max_h = max(pair_hours.values())
    min_h = min(pair_hours.values())
    assert max_h - min_h <= 4.0, (
        f"Maximin violated: spread {min_h:.1f}h..{max_h:.1f}h across {pair_hours}"
    )


def test_timezone_mismatch_handles_disjoint_evenings() -> None:
    """Denver/London/Tokyo have non-overlapping local evenings. The solver
    should still run successfully even if no schedule is found."""
    req = _build(timezone_mismatch())
    resp = solve(req)
    # Either feasible (some overlap exists) or cleanly empty with notes.
    assert isinstance(resp.proposed_blocks, list)
    if not resp.proposed_blocks:
        assert resp.infeasibility_notes


def test_solver_completes_under_2s_for_10_persons_7_days() -> None:
    """Performance gate from the implementation plan (P4.5.6)."""
    persons = []
    prefs = []
    person_ids = [f"X{i}" for i in range(10)]
    for pid in person_ids:
        persons.append(
            {"person_id": pid, "timezone": "UTC",
             "free_windows": evening_windows(pid, 7)}
        )
    # Pair the 10 persons into 5 partnerships.
    for i in range(0, 10, 2):
        a, b = person_ids[i], person_ids[i + 1]
        prefs.append({"person_id": a, "partner_id": b,
                      "pref_ideal_hours": 6, "need_min_hours": 2})
        prefs.append({"person_id": b, "partner_id": a,
                      "pref_ideal_hours": 6, "need_min_hours": 2})

    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=7),
        "persons": persons,
        "partner_preferences": prefs,
        "event_types": [
            {"label": "Date Night", "duration_minutes": 210},
            {"label": "Daytime Hang", "duration_minutes": 150},
        ],
    }
    req = _build(config)

    start = time.time()
    resp = solve(req)
    elapsed_ms = int((time.time() - start) * 1000)

    assert resp.proposed_blocks, "expected a feasible schedule for 10 persons"
    assert elapsed_ms < 2000, f"solver took {elapsed_ms}ms, > 2s budget"


def test_solver_returns_empty_response_when_no_overlap() -> None:
    """When no shared free time exists, response is empty, not exceptions."""
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=7),
        "persons": [
            {
                "person_id": "A",
                "timezone": "UTC",
                "free_windows": [
                    {"start": HORIZON_START.replace(hour=8),
                     "end": HORIZON_START.replace(hour=12)}
                ],
            },
            {
                "person_id": "B",
                "timezone": "UTC",
                "free_windows": [
                    {"start": HORIZON_START.replace(hour=18),
                     "end": HORIZON_START.replace(hour=22)}
                ],
            },
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 4},
        ],
        "event_types": [{"label": "Date Night", "duration_minutes": 180}],
    }
    resp = solve(_build(config))
    assert resp.proposed_blocks == []
    assert resp.infeasibility_notes
    assert resp.variable_count == 0
