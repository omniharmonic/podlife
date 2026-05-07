"""Realistic polycule configurations for stress-testing the optimizer.

Each fixture returns a tuple of (config_dict, expected_outcome_dict). The
config is suitable to pass to OptimizationRequest(...). The expected_outcome
captures the bounds the test runner uses to validate the solver's behaviour.

These fixtures complement the simpler shapes in polycule_configs.py by
exercising more realistic scenarios: kitchen-table quads, solo-poly hubs,
mixed-availability multi-pod situations, and oversubscribed groups where
hard minimums force infeasibility.

All fixtures use synthetic single-letter / numeric ids — never real names.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from .polycule_configs import (
    DEFAULT_EVENT_TYPES,
    HORIZON_START,
    evening_windows,
    limited_windows,
)


def _full_evenings_plus_weekend(
    person_id: str,  # noqa: ARG001
    days: int = 7,
) -> list[dict[str, datetime]]:
    """Generous availability: 18:00–23:00 every day + 10:00–22:00 on Sat/Sun."""
    windows: list[dict[str, datetime]] = []
    for d in range(days):
        day_start = HORIZON_START + timedelta(days=d)
        # Weekday is 0=Mon .. 6=Sun. Our HORIZON_START is Monday.
        weekday = (HORIZON_START + timedelta(days=d)).weekday()
        if weekday >= 5:  # Saturday or Sunday — more daytime availability.
            windows.append({
                "start": day_start.replace(hour=10),
                "end": day_start.replace(hour=22),
            })
        else:
            windows.append({
                "start": day_start.replace(hour=18),
                "end": day_start.replace(hour=23),
            })
    return windows


def _wrap(config: dict[str, Any], days: int = 7) -> dict[str, Any]:
    config.setdefault("horizon_start", HORIZON_START)
    config.setdefault("horizon_end", HORIZON_START + timedelta(days=days))
    config.setdefault("event_types", DEFAULT_EVENT_TYPES)
    config.setdefault("slot_duration_minutes", 30)
    config.setdefault("pod_gatherings", [])
    config.setdefault("subgroup_prefs", [])
    config.setdefault("locked_blocks", [])
    return config


# ── Fixtures ─────────────────────────────────────────────────────────────


def triad_v_with_metamours() -> tuple[dict[str, Any], dict[str, Any]]:
    """A↔B and A↔C partnered. B and C are metamours sharing a pod (not partners).

    A wants 8h with each (16h total). B wants 10h with A. C wants 6h with A.
    All 3 want a monthly pod gathering (modeled here as 1 in the 7-day horizon).
    All have 5 free evenings (Mon–Fri) of 5h each.
    """
    config = _wrap({
        "persons": [
            {"person_id": "A", "timezone": "America/Denver",
             "free_windows": evening_windows("A", 5)},
            {"person_id": "B", "timezone": "America/Denver",
             "free_windows": evening_windows("B", 5)},
            {"person_id": "C", "timezone": "America/Denver",
             "free_windows": evening_windows("C", 5)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B",
             "pref_ideal_hours": 8, "need_min_hours": 3},
            {"person_id": "A", "partner_id": "C",
             "pref_ideal_hours": 8, "need_min_hours": 3},
            {"person_id": "B", "partner_id": "A",
             "pref_ideal_hours": 10, "need_min_hours": 4},
            {"person_id": "C", "partner_id": "A",
             "pref_ideal_hours": 6, "need_min_hours": 2},
        ],
        "pod_gatherings": [
            {"pod_id": "pod_avc", "member_ids": ["A", "B", "C"],
             "frequency": 1, "duration_hours": 3},
        ],
    })
    expected = {
        "feasible": True,
        "min_satisfaction_pct": 40,
        "max_satisfaction_pct": 100,
        "expected_pod_gathering": True,
        "max_solver_ms": 5000,
    }
    return config, expected


def quad_kitchen_table() -> tuple[dict[str, Any], dict[str, Any]]:
    """4 people, all partnered with each other (full graph K4), one pod.

    Different desire levels stress the maximin objective with asymmetric demand.
    A wants 5h with each (15h total). B wants 8h with A, 4h with each of C,D.
    C wants 6h with each (18h). D wants 3h with each (9h).
    Pod gathering 1×/week.
    """
    persons = [
        {"person_id": pid, "timezone": "America/Denver",
         "free_windows": _full_evenings_plus_weekend(pid)}
        for pid in ("A", "B", "C", "D")
    ]
    prefs = [
        # A side
        {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 5, "need_min_hours": 2},
        {"person_id": "A", "partner_id": "C", "pref_ideal_hours": 5, "need_min_hours": 2},
        {"person_id": "A", "partner_id": "D", "pref_ideal_hours": 5, "need_min_hours": 2},
        # B side
        {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 8, "need_min_hours": 3},
        {"person_id": "B", "partner_id": "C", "pref_ideal_hours": 4, "need_min_hours": 1},
        {"person_id": "B", "partner_id": "D", "pref_ideal_hours": 4, "need_min_hours": 1},
        # C side
        {"person_id": "C", "partner_id": "A", "pref_ideal_hours": 6, "need_min_hours": 2},
        {"person_id": "C", "partner_id": "B", "pref_ideal_hours": 6, "need_min_hours": 2},
        {"person_id": "C", "partner_id": "D", "pref_ideal_hours": 6, "need_min_hours": 2},
        # D side
        {"person_id": "D", "partner_id": "A", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "D", "partner_id": "B", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "D", "partner_id": "C", "pref_ideal_hours": 3, "need_min_hours": 1},
    ]
    config = _wrap({
        "persons": persons,
        "partner_preferences": prefs,
        "pod_gatherings": [
            {"pod_id": "pod_quad", "member_ids": ["A", "B", "C", "D"],
             "frequency": 1, "duration_hours": 3},
        ],
    })
    expected = {
        "feasible": True,
        "min_satisfaction_pct": 30,
        "max_satisfaction_pct": 100,
        "expected_pod_gathering": True,
        "max_solver_ms": 5000,
    }
    return config, expected


def solo_poly_5_partners() -> tuple[dict[str, Any], dict[str, Any]]:
    """A is solo-poly with 5 partners (B–F), no pod overlap.

    A has 12 free evenings (3.5h each = 42h) over a 7-day horizon? Actually
    only 7 evenings per week — we model "12" by extending the horizon to
    14 days. Each partner wants 6h with A.
    """
    # 14-day horizon to give A enough evenings to meet 5 partners.
    days = 14
    persons = [
        {"person_id": "A", "timezone": "America/Denver",
         "free_windows": evening_windows("A", days)},
    ]
    for pid in ("B", "C", "D", "E", "F"):
        persons.append({
            "person_id": pid,
            "timezone": "America/Denver",
            "free_windows": evening_windows(pid, days),
        })
    prefs = []
    for pid in ("B", "C", "D", "E", "F"):
        prefs.append({"person_id": "A", "partner_id": pid,
                      "pref_ideal_hours": 6, "need_min_hours": 2})
        prefs.append({"person_id": pid, "partner_id": "A",
                      "pref_ideal_hours": 6, "need_min_hours": 2})
    config = _wrap({
        "persons": persons,
        "partner_preferences": prefs,
    }, days=days)
    expected = {
        "feasible": True,
        "min_satisfaction_pct": 30,
        "max_satisfaction_pct": 100,
        "max_solver_ms": 5000,
        # 5 partners × 2h need = 10h hard minimum from A's side.
        "min_hours_per_partner": 2.0,
    }
    return config, expected


def mixed_demand_5person() -> tuple[dict[str, Any], dict[str, Any]]:
    """5 people in a complex polycule.

    Edges: A↔B, A↔C (B and C are metamours via pod1 with A).
           D↔E partnership (separate pod2).
           A↔E too — A is in two pods: pod1 {A,B,C} and pod2 {A,D,E}.
    Different evening availabilities per person.
    """
    persons = [
        # A — limited (4 evenings — busy person)
        {"person_id": "A", "timezone": "America/Denver",
         "free_windows": limited_windows("A", 4)},
        # B — full evenings
        {"person_id": "B", "timezone": "America/Denver",
         "free_windows": evening_windows("B", 7)},
        # C — 6 evenings
        {"person_id": "C", "timezone": "America/Denver",
         "free_windows": limited_windows("C", 6)},
        # D — 5 evenings
        {"person_id": "D", "timezone": "America/Denver",
         "free_windows": limited_windows("D", 5)},
        # E — full
        {"person_id": "E", "timezone": "America/Denver",
         "free_windows": evening_windows("E", 7)},
    ]
    prefs = [
        {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 5, "need_min_hours": 2},
        {"person_id": "A", "partner_id": "C", "pref_ideal_hours": 5, "need_min_hours": 2},
        {"person_id": "A", "partner_id": "E", "pref_ideal_hours": 4, "need_min_hours": 1},
        {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 7, "need_min_hours": 3},
        {"person_id": "C", "partner_id": "A", "pref_ideal_hours": 7, "need_min_hours": 3},
        {"person_id": "D", "partner_id": "E", "pref_ideal_hours": 8, "need_min_hours": 3},
        {"person_id": "E", "partner_id": "D", "pref_ideal_hours": 8, "need_min_hours": 3},
        {"person_id": "E", "partner_id": "A", "pref_ideal_hours": 4, "need_min_hours": 1},
    ]
    config = _wrap({
        "persons": persons,
        "partner_preferences": prefs,
        "pod_gatherings": [
            {"pod_id": "pod1", "member_ids": ["A", "B", "C"],
             "frequency": 1, "duration_hours": 3},
            {"pod_id": "pod2", "member_ids": ["A", "D", "E"],
             "frequency": 1, "duration_hours": 3},
        ],
    })
    expected = {
        "feasible": True,
        "min_satisfaction_pct": 30,
        "max_satisfaction_pct": 100,
        "max_solver_ms": 5000,
    }
    return config, expected


def busy_week_8person() -> tuple[dict[str, Any], dict[str, Any]]:
    """8 people across 3 overlapping pods. Heavily oversubscribed.

    Hub person "A" is in all three pods. Each person has at least one strict
    need (need_min_hours > 0). Total demand exceeds supply → expect
    infeasibility OR partial fulfillment with unmet needs.

    Pod1 = {A, B, C} ; Pod2 = {A, D, E} ; Pod3 = {A, F, G, H}
    """
    persons = []
    for pid in ("A",):
        # A is the hub but only has 3 free evenings — extreme oversubscription.
        persons.append({
            "person_id": pid, "timezone": "America/Denver",
            "free_windows": limited_windows(pid, 3),
        })
    for pid in ("B", "C", "D", "E", "F", "G", "H"):
        persons.append({
            "person_id": pid, "timezone": "America/Denver",
            "free_windows": evening_windows(pid, 7),
        })

    prefs = []
    # A wants time with everyone but each partner pushes a strict need.
    for partner in ("B", "C", "D", "E", "F", "G", "H"):
        prefs.append({"person_id": "A", "partner_id": partner,
                      "pref_ideal_hours": 4, "need_min_hours": 2})
        prefs.append({"person_id": partner, "partner_id": "A",
                      "pref_ideal_hours": 4, "need_min_hours": 2})

    config = _wrap({
        "persons": persons,
        "partner_preferences": prefs,
        "pod_gatherings": [
            {"pod_id": "pod1", "member_ids": ["A", "B", "C"],
             "frequency": 1, "duration_hours": 3},
            {"pod_id": "pod2", "member_ids": ["A", "D", "E"],
             "frequency": 1, "duration_hours": 3},
            {"pod_id": "pod3", "member_ids": ["A", "F", "G", "H"],
             "frequency": 1, "duration_hours": 3},
        ],
    })
    # A has 3 evenings × 5h = 15h. Total minimums on A: 7 × 2 = 14h. Plus
    # pod gatherings 9h. Without double-booking, infeasible.
    expected = {
        "feasible": False,
        "max_solver_ms": 5000,
        "expect_unmet_needs": True,
    }
    return config, expected


def relaxed_pod_3person() -> tuple[dict[str, Any], dict[str, Any]]:
    """3 partners, generous availability, modest needs. Should produce HIGH
    satisfaction across the board (sanity-check upper bound)."""
    persons = [
        {"person_id": pid, "timezone": "America/Denver",
         "free_windows": _full_evenings_plus_weekend(pid)}
        for pid in ("A", "B", "C")
    ]
    prefs = [
        {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "A", "partner_id": "C", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "B", "partner_id": "C", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "C", "partner_id": "A", "pref_ideal_hours": 3, "need_min_hours": 1},
        {"person_id": "C", "partner_id": "B", "pref_ideal_hours": 3, "need_min_hours": 1},
    ]
    config = _wrap({
        "persons": persons,
        "partner_preferences": prefs,
    })
    expected = {
        "feasible": True,
        "min_satisfaction_pct": 80,
        "max_satisfaction_pct": 100,
        "max_solver_ms": 3000,
        "max_fairness_gap_pp": 25,
    }
    return config, expected


def tight_constraints_4person() -> tuple[dict[str, Any], dict[str, Any]]:
    """4 partners (full K4 graph), with locked_blocks acting as recurring holds.

    Tuesday evening is locked for A↔B. Pod gathering happens on Sunday.
    All have full evenings. Verifies that locked blocks block other pairings
    in those slots and that the optimizer routes around them.
    """
    persons = [
        {"person_id": pid, "timezone": "America/Denver",
         "free_windows": _full_evenings_plus_weekend(pid)}
        for pid in ("A", "B", "C", "D")
    ]
    prefs = []
    for a, b in [("A", "B"), ("A", "C"), ("A", "D"),
                 ("B", "C"), ("B", "D"), ("C", "D")]:
        prefs.append({"person_id": a, "partner_id": b,
                      "pref_ideal_hours": 4, "need_min_hours": 1})
        prefs.append({"person_id": b, "partner_id": a,
                      "pref_ideal_hours": 4, "need_min_hours": 1})

    # Tuesday is May 12, 2026 (HORIZON_START is Mon May 11).
    tuesday_evening_start = (HORIZON_START + timedelta(days=1)).replace(hour=18)
    tuesday_evening_end = (HORIZON_START + timedelta(days=1)).replace(hour=22)

    config = _wrap({
        "persons": persons,
        "partner_preferences": prefs,
        "pod_gatherings": [
            {"pod_id": "pod_quad", "member_ids": ["A", "B", "C", "D"],
             "frequency": 1, "duration_hours": 3},
        ],
        "locked_blocks": [
            # Lock A & B together Tuesday 18:00–22:00 (4h) — represents a recurring hold.
            {"start": tuesday_evening_start, "end": tuesday_evening_end,
             "participant_ids": ["A", "B"]},
        ],
    })
    expected = {
        "feasible": True,
        "min_satisfaction_pct": 25,
        "max_satisfaction_pct": 100,
        "max_solver_ms": 5000,
        # Locked block should NOT generate proposed_blocks, but should block
        # other pairings overlapping that slot.
        "locked_block_respected": True,
    }
    return config, expected


# ── Registry for the test runner ─────────────────────────────────────────


ALL_FIXTURES: dict[str, Any] = {
    "triad_v_with_metamours": triad_v_with_metamours,
    "quad_kitchen_table": quad_kitchen_table,
    "solo_poly_5_partners": solo_poly_5_partners,
    "mixed_demand_5person": mixed_demand_5person,
    "busy_week_8person": busy_week_8person,
    "relaxed_pod_3person": relaxed_pod_3person,
    "tight_constraints_4person": tight_constraints_4person,
}
