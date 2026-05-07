"""Unit tests for candidate slot discovery."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.models import OptimizationRequest
from src.slot_discovery import _find_contiguous_runs, discover_candidate_slots

from .fixtures.polycule_configs import HORIZON_START, evening_windows, triad_basic


def _request_from(config: dict) -> OptimizationRequest:
    return OptimizationRequest.model_validate(config)


def test_find_contiguous_runs_basic() -> None:
    assert _find_contiguous_runs([]) == []
    assert _find_contiguous_runs([3]) == [(3, 4)]
    assert _find_contiguous_runs([1, 2, 3, 7, 8, 10]) == [(1, 4), (7, 9), (10, 11)]


def test_two_persons_overlap_yields_candidates() -> None:
    """Two persons sharing 5h evenings × 7 days produce many candidates."""
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC",
             "free_windows": evening_windows("A", 7)},
            {"person_id": "B", "timezone": "UTC",
             "free_windows": evening_windows("B", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 6},
        ],
        "event_types": [
            {"label": "Date Night", "duration_minutes": 180},
        ],
    }
    req = _request_from(config)
    horizon_slots = int((req.horizon_end - req.horizon_start).total_seconds() / 60 / 30)
    cands = discover_candidate_slots(req, horizon_slots)

    # Each evening is 5h = 10 slots; a 3h (6-slot) Date Night fits with 5 offsets.
    # 7 days × 5 offsets = 35 candidates.
    assert len(cands) == 35
    assert all(c.participant_ids == frozenset({"A", "B"}) for c in cands)
    assert all(c.event_type == "Date Night" for c in cands)


def test_no_overlap_yields_empty_candidates() -> None:
    """If A is free morning and B is free evening, no shared slots exist."""
    morning = [
        {
            "start": HORIZON_START + timedelta(days=d, hours=9),
            "end": HORIZON_START + timedelta(days=d, hours=12),
        }
        for d in range(7)
    ]
    evening = [
        {
            "start": HORIZON_START + timedelta(days=d, hours=18),
            "end": HORIZON_START + timedelta(days=d, hours=22),
        }
        for d in range(7)
    ]
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC", "free_windows": morning},
            {"person_id": "B", "timezone": "UTC", "free_windows": evening},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 4},
        ],
        "event_types": [{"label": "Date Night", "duration_minutes": 180}],
    }
    req = _request_from(config)
    horizon_slots = int((req.horizon_end - req.horizon_start).total_seconds() / 60 / 30)
    assert discover_candidate_slots(req, horizon_slots) == []


def test_locked_blocks_excluded_from_candidates() -> None:
    """A locked block on day 0 18:00–23:00 should remove that day's candidates."""
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC",
             "free_windows": evening_windows("A", 7)},
            {"person_id": "B", "timezone": "UTC",
             "free_windows": evening_windows("B", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 6},
        ],
        "event_types": [{"label": "Date Night", "duration_minutes": 180}],
        "locked_blocks": [
            {
                "start": HORIZON_START.replace(hour=18),
                "end": HORIZON_START.replace(hour=23),
                "participant_ids": ["A"],
            }
        ],
    }
    req = _request_from(config)
    horizon_slots = int((req.horizon_end - req.horizon_start).total_seconds() / 60 / 30)
    cands = discover_candidate_slots(req, horizon_slots)

    # 6 evenings × 5 offsets = 30; day 0 lost.
    assert len(cands) == 30
    # No candidate may start on day 0.
    for c in cands:
        cand_start = req.horizon_start + timedelta(minutes=c.start_slot * 30)
        assert cand_start.date() != HORIZON_START.date()


def test_pod_gathering_requires_all_members_free() -> None:
    """Pod gathering shrinks to only the slots when ALL members are free."""
    # A and B are free 18-23 every day; C is free only Monday 18-23.
    a_free = evening_windows("A", 7)
    b_free = evening_windows("B", 7)
    c_free = [
        {
            "start": HORIZON_START.replace(hour=18),
            "end": HORIZON_START.replace(hour=23),
        }
    ]
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=7),
        "persons": [
            {"person_id": "A", "timezone": "UTC", "free_windows": a_free},
            {"person_id": "B", "timezone": "UTC", "free_windows": b_free},
            {"person_id": "C", "timezone": "UTC", "free_windows": c_free},
        ],
        "partner_preferences": [],
        "pod_gatherings": [
            {"pod_id": "pod1", "member_ids": ["A", "B", "C"],
             "frequency": 1, "duration_hours": 3},
        ],
        "event_types": [
            {"label": "Pod Gathering", "duration_minutes": 180},
        ],
    }
    req = _request_from(config)
    horizon_slots = int((req.horizon_end - req.horizon_start).total_seconds() / 60 / 30)
    cands = discover_candidate_slots(req, horizon_slots)

    # 3h pod gathering = 6 slots; Mon 18-23 = 10 slots; 5 offsets only.
    assert len(cands) == 5
    assert all(c.event_type == "Pod Gathering" for c in cands)
    assert all(c.participant_ids == frozenset({"A", "B", "C"}) for c in cands)


def test_triad_fixture_produces_candidates() -> None:
    """End-to-end smoke test on the triad_basic fixture."""
    req = _request_from(triad_basic())
    horizon_slots = int((req.horizon_end - req.horizon_start).total_seconds() / 60 / 30)
    cands = discover_candidate_slots(req, horizon_slots)
    assert len(cands) > 0
    # All three pair types present.
    pairs = {c.participant_ids for c in cands if len(c.participant_ids) == 2}
    assert frozenset({"A", "B"}) in pairs
    assert frozenset({"A", "C"}) in pairs
    assert frozenset({"B", "C"}) in pairs
    # Pod gathering candidates exist.
    assert any(c.event_type == "Pod Gathering" for c in cands)


def test_horizon_clipping() -> None:
    """A free window extending past horizon_end is clipped, not crashed."""
    config = {
        "horizon_start": HORIZON_START,
        "horizon_end": HORIZON_START + timedelta(days=1),
        "persons": [
            {
                "person_id": "A",
                "timezone": "UTC",
                "free_windows": [
                    {
                        "start": HORIZON_START.replace(hour=18),
                        # Window spills 5 days past horizon
                        "end": HORIZON_START + timedelta(days=5),
                    }
                ],
            },
            {
                "person_id": "B",
                "timezone": "UTC",
                "free_windows": [
                    {
                        "start": HORIZON_START.replace(hour=18),
                        "end": HORIZON_START.replace(hour=23),
                    }
                ],
            },
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 4},
        ],
        "event_types": [{"label": "Date Night", "duration_minutes": 180}],
    }
    req = _request_from(config)
    horizon_slots = int((req.horizon_end - req.horizon_start).total_seconds() / 60 / 30)
    cands = discover_candidate_slots(req, horizon_slots)
    # All candidates must finish before horizon_end.
    for c in cands:
        end_time = req.horizon_start + timedelta(minutes=c.end_slot * 30)
        assert end_time <= req.horizon_end


# Suppress unused imports complaint
_ = (datetime, timezone)
