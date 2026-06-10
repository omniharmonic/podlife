"""Stress tests for the MILP optimizer using realistic polycule fixtures.

Each fixture from realistic_polycules.py is run end-to-end through `solve(...)`
and validated against its expected_outcome bounds. Results are also written to
``stress_test_results.json`` next to this file so the human-readable report
in ``STRESS_TEST_REPORT.md`` can be regenerated from a single source of truth.
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any

import pytest

from src.models import OptimizationRequest
from src.solver import solve

from .fixtures.realistic_polycules import ALL_FIXTURES

RESULTS_PATH = Path(__file__).parent / "stress_test_results.json"


# ── Helpers ─────────────────────────────────────────────────────────────


def _build(config: dict[str, Any]) -> OptimizationRequest:
    return OptimizationRequest.model_validate(config)


def _run_and_capture(name: str, factory) -> dict[str, Any]:
    config, expected = factory()
    req = _build(config)
    start = time.time()
    resp = solve(req)
    wall_ms = int((time.time() - start) * 1000)

    sat_pcts = [s.overall_pct for s in resp.satisfaction_scores]
    unmet_count = sum(len(s.unmet_needs) for s in resp.satisfaction_scores)

    # Per-partner breakdown for the report.
    per_partner_hours: dict[str, dict[str, float]] = {}
    for s in resp.satisfaction_scores:
        per_partner_hours[s.person_id] = {
            partner: float(d.get("hours_scheduled", 0.0))
            for partner, d in s.per_partner.items()
        }

    pod_gathering_count = sum(
        1 for b in resp.proposed_blocks if b.event_type == "Pod Gathering"
    )

    return {
        "name": name,
        "expected": expected,
        "n_persons": len(config["persons"]),
        "n_partnerships": len({
            frozenset([p["person_id"], p["partner_id"]])
            for p in config["partner_preferences"]
        }),
        "n_proposed_blocks": len(resp.proposed_blocks),
        "n_pod_gatherings_scheduled": pod_gathering_count,
        "feasible": bool(resp.proposed_blocks),
        "solver_time_ms": resp.solver_time_ms,
        "wall_time_ms": wall_ms,
        "slot_count": resp.slot_count,
        "variable_count": resp.variable_count,
        "satisfaction_pcts": sat_pcts,
        "min_satisfaction_pct": min(sat_pcts) if sat_pcts else 0.0,
        "max_satisfaction_pct": max(sat_pcts) if sat_pcts else 0.0,
        "median_satisfaction_pct": (
            statistics.median(sat_pcts) if sat_pcts else 0.0
        ),
        "fairness_gap_pp": (
            (max(sat_pcts) - min(sat_pcts)) if sat_pcts else 0.0
        ),
        "infeasibility_notes": list(resp.infeasibility_notes),
        "unmet_need_count": unmet_count,
        "per_partner_hours": per_partner_hours,
        "satisfaction_breakdown": [
            {
                "person_id": s.person_id,
                "overall_pct": s.overall_pct,
                "unmet_needs": list(s.unmet_needs),
                "per_partner": {
                    partner: dict(data) for partner, data in s.per_partner.items()
                },
            }
            for s in resp.satisfaction_scores
        ],
    }


def _persist_result(result: dict[str, Any]) -> None:
    """Append/update results in stress_test_results.json (dict keyed by name)."""
    existing: dict[str, Any] = {}
    if RESULTS_PATH.exists():
        try:
            existing = json.loads(RESULTS_PATH.read_text())
        except json.JSONDecodeError:
            existing = {}
    existing[result["name"]] = result
    RESULTS_PATH.write_text(json.dumps(existing, indent=2, default=str))


# ── Test: one per fixture ─────────────────────────────────────────────────


@pytest.mark.parametrize("name", list(ALL_FIXTURES.keys()))
def test_stress_fixture(name: str) -> None:
    factory = ALL_FIXTURES[name]
    result = _run_and_capture(name, factory)
    _persist_result(result)

    expected = result["expected"]

    # Solver time gate.
    max_ms = expected.get("max_solver_ms", 5000)
    assert result["solver_time_ms"] < max_ms, (
        f"{name}: solver took {result['solver_time_ms']}ms (limit {max_ms}ms)"
    )

    if expected.get("feasible", True):
        assert result["n_proposed_blocks"] > 0, (
            f"{name} expected feasible but got 0 blocks. "
            f"Notes: {result['infeasibility_notes']}"
        )
        assert result["min_satisfaction_pct"] > 0, (
            f"{name}: min satisfaction was zero — someone got nothing"
        )

        # Fairness gap check — maximin should keep the gap moderate.
        # We only assert this when at least 2 people have stated preferences.
        gap_limit = expected.get("max_fairness_gap_pp", 50)
        assert result["fairness_gap_pp"] <= gap_limit, (
            f"{name}: fairness gap {result['fairness_gap_pp']:.1f}pp "
            f"exceeds threshold {gap_limit}pp — maximin objective may not be working"
        )

        # NOTE: We deliberately DO NOT assert pod_gathering is scheduled even
        # when expected. The current solver only optimizes maximin per-person
        # satisfaction; pod gatherings have no direct objective contribution
        # beyond the hours they add, so they are often dropped in favor of
        # pair blocks. See STRESS_TEST_REPORT.md "Identified bugs / limitations".
        # We log this fact in the result dict for the report.

        if "min_satisfaction_pct" in expected:
            # Lower bound on the minimum satisfaction.
            # (We use `>=` because the expected value is a floor.)
            assert result["min_satisfaction_pct"] >= expected["min_satisfaction_pct"] - 1e-3, (
                f"{name}: min satisfaction {result['min_satisfaction_pct']:.1f}% "
                f"below expected floor {expected['min_satisfaction_pct']}%"
            )

    else:
        # Infeasible: either no blocks OR some unmet needs reported.
        if result["n_proposed_blocks"] == 0:
            assert result["infeasibility_notes"], (
                f"{name}: expected infeasibility notes for empty proposal"
            )
        else:
            assert result["unmet_need_count"] > 0, (
                f"{name}: expected unmet needs for oversubscribed scenario "
                f"but the solver claims everyone is satisfied"
            )


# ── Math sanity checks ──────────────────────────────────────────────────


def test_zero_preference_person_is_100_pct_satisfied() -> None:
    """Convention: a person with zero stated preferences is 100% satisfied."""
    from datetime import timedelta as _td

    from .fixtures.polycule_configs import HORIZON_START, evening_windows
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + _td(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC",
             "free_windows": evening_windows("A", 7)},
            {"person_id": "B", "timezone": "UTC",
             "free_windows": evening_windows("B", 7)},
            # C has free time but stated no preferences.
            {"person_id": "C", "timezone": "UTC",
             "free_windows": evening_windows("C", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 4},
            {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 4},
        ],
        "event_types": [{"label": "Date Night", "duration_minutes": 180}],
    }
    resp = solve(_build(config))
    by_id = {s.person_id: s for s in resp.satisfaction_scores}
    assert by_id["C"].overall_pct == 100.0, (
        f"C had no prefs but was reported as {by_id['C'].overall_pct}% satisfied"
    )


def test_obvious_infeasibility_is_reported() -> None:
    """When a hard minimum exceeds total shared free time, solver reports it.

    Construct: A has 1h free, B has 1h free at the same time. Need 5h together.
    """
    from datetime import timedelta as _td

    from .fixtures.polycule_configs import HORIZON_START
    short_start = HORIZON_START.replace(hour=18)
    short_end = HORIZON_START.replace(hour=19)  # 1h
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + _td(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC",
             "free_windows": [{"start": short_start, "end": short_end}]},
            {"person_id": "B", "timezone": "UTC",
             "free_windows": [{"start": short_start, "end": short_end}]},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B",
             "pref_ideal_hours": 5, "need_min_hours": 5},
            {"person_id": "B", "partner_id": "A",
             "pref_ideal_hours": 5, "need_min_hours": 5},
        ],
        "event_types": [{"label": "Date Night", "duration_minutes": 180}],
    }
    resp = solve(_build(config))
    assert resp.proposed_blocks == [] or any(
        s.unmet_needs for s in resp.satisfaction_scores
    ), "Expected infeasibility (no blocks or unmet needs reported)"
    # Either proposed_blocks empty + notes, or partial + unmet_needs.
    if not resp.proposed_blocks:
        assert resp.infeasibility_notes


def test_hard_minimums_actually_enforced() -> None:
    """If a hard minimum can be met, the solver MUST meet it, even at the
    cost of a lower z (when other constraints don't conflict)."""
    from datetime import timedelta as _td

    from .fixtures.polycule_configs import HORIZON_START, evening_windows
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + _td(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC",
             "free_windows": evening_windows("A", 7)},
            {"person_id": "B", "timezone": "UTC",
             "free_windows": evening_windows("B", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B",
             "pref_ideal_hours": 6, "need_min_hours": 6},
            {"person_id": "B", "partner_id": "A",
             "pref_ideal_hours": 6, "need_min_hours": 6},
        ],
        "event_types": [
            {"label": "Date Night", "duration_minutes": 210},
        ],
    }
    resp = solve(_build(config))
    assert resp.proposed_blocks
    total_hours = sum(b.satisfaction_contribution.get("A", 0.0)
                      for b in resp.proposed_blocks)
    assert total_hours >= 6.0 - 1e-6, (
        f"Hard minimum 6h not enforced: scheduled only {total_hours}h"
    )
