"""Synthetic polycule configurations for testing the optimizer.

Each fixture returns a dict ready to be passed to OptimizationRequest(...).
The `evening_windows`, `limited_windows`, and `evening_windows_tz` helpers
generate realistic free-window data anchored to a fixed Monday 2026-05-11.

See pod-life-technical-architecture.md § 15.2.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

# Monday, 2026-05-11 00:00 UTC. All horizons start here so tests are deterministic.
HORIZON_START: datetime = datetime(2026, 5, 11, 0, 0, tzinfo=UTC)
HORIZON_DAYS_DEFAULT = 7

DEFAULT_EVENT_TYPES: list[dict[str, Any]] = [
    {"label": "Date Night", "duration_minutes": 210, "blocks_next_morning": False},
    {"label": "Overnight", "duration_minutes": 720, "blocks_next_morning": True},
    {"label": "Daytime Hang", "duration_minutes": 150, "blocks_next_morning": False},
    {"label": "Pod Gathering", "duration_minutes": 210, "blocks_next_morning": False},
    {"label": "Sub-group Hang", "duration_minutes": 150, "blocks_next_morning": False},
]


def _horizon_end(days: int = HORIZON_DAYS_DEFAULT) -> datetime:
    return HORIZON_START + timedelta(days=days)


def evening_windows(
    person_id: str,  # noqa: ARG001 (kept to mirror spec signature)
    days: int,
    start_hour: int = 18,
    end_hour: int = 23,
) -> list[dict[str, datetime]]:
    """One UTC evening window (18:00–23:00) per day, for `days` consecutive days."""
    windows: list[dict[str, datetime]] = []
    for d in range(days):
        day_start = HORIZON_START + timedelta(days=d)
        windows.append(
            {
                "start": day_start.replace(hour=start_hour),
                "end": day_start.replace(hour=end_hour),
            }
        )
    return windows


def limited_windows(
    person_id: str, n_evenings: int, start_hour: int = 18, end_hour: int = 23
) -> list[dict[str, datetime]]:
    """Only `n_evenings` evenings free in a 7-day horizon (other evenings are busy)."""
    return evening_windows(person_id, n_evenings, start_hour, end_hour)


def evening_windows_tz(
    person_id: str,  # noqa: ARG001
    tz_name: str,
    days: int,
    start_hour_local: int = 18,
    end_hour_local: int = 23,
) -> list[dict[str, datetime]]:
    """Evenings expressed in the person's local timezone, then converted to UTC.

    Tests timezone handling: each person's "evening" is local 18:00–23:00; the
    resulting UTC windows differ across persons in different zones.
    """
    tz = ZoneInfo(tz_name)
    # Anchor the local-day calendar from the same wall-clock date as HORIZON_START.
    base_local_day = HORIZON_START.astimezone(tz).date()
    windows: list[dict[str, datetime]] = []
    for d in range(days):
        local_day = base_local_day + timedelta(days=d)
        local_start = datetime(
            local_day.year, local_day.month, local_day.day, start_hour_local, tzinfo=tz
        )
        local_end = datetime(
            local_day.year, local_day.month, local_day.day, end_hour_local, tzinfo=tz
        )
        windows.append(
            {
                "start": local_start.astimezone(UTC),
                "end": local_end.astimezone(UTC),
            }
        )
    return windows


# ── Fixture factories ───────────────────────────────────────────────────


def _wrap(config: dict[str, Any], days: int = HORIZON_DAYS_DEFAULT) -> dict[str, Any]:
    """Add the boilerplate fields (horizon, event_types) to a polycule config."""
    config.setdefault("horizon_start", HORIZON_START)
    config.setdefault("horizon_end", _horizon_end(days))
    config.setdefault("event_types", DEFAULT_EVENT_TYPES)
    config.setdefault("slot_duration_minutes", 30)
    config.setdefault("pod_gatherings", [])
    config.setdefault("subgroup_prefs", [])
    config.setdefault("locked_blocks", [])
    return config


def triad_basic() -> dict[str, Any]:
    """A, B, C all partnered with each other. Classic triad."""
    return _wrap(
        {
            "persons": [
                {"person_id": "A", "timezone": "America/Denver",
                 "free_windows": evening_windows("A", 7)},
                {"person_id": "B", "timezone": "America/Denver",
                 "free_windows": evening_windows("B", 7)},
                {"person_id": "C", "timezone": "America/Denver",
                 "free_windows": evening_windows("C", 7)},
            ],
            "partner_preferences": [
                {"person_id": "A", "partner_id": "B",
                 "pref_ideal_hours": 6, "pref_date_nights": 2},
                {"person_id": "A", "partner_id": "C",
                 "pref_ideal_hours": 6, "pref_date_nights": 2},
                {"person_id": "B", "partner_id": "A",
                 "pref_ideal_hours": 6, "pref_date_nights": 2},
                {"person_id": "B", "partner_id": "C",
                 "pref_ideal_hours": 4, "pref_date_nights": 1},
                {"person_id": "C", "partner_id": "A",
                 "pref_ideal_hours": 6, "pref_date_nights": 2},
                {"person_id": "C", "partner_id": "B",
                 "pref_ideal_hours": 4, "pref_date_nights": 1},
            ],
            "pod_gatherings": [
                {
                    "pod_id": "pod1",
                    "member_ids": ["A", "B", "C"],
                    "frequency": 1,
                    "duration_hours": 3,
                }
            ],
        }
    )


def v_structure() -> dict[str, Any]:
    """A is partnered with B and C; B and C are not partners."""
    return _wrap(
        {
            "persons": [
                {"person_id": "A", "timezone": "America/Denver",
                 "free_windows": evening_windows("A", 7)},
                {"person_id": "B", "timezone": "America/Denver",
                 "free_windows": evening_windows("B", 7)},
                {"person_id": "C", "timezone": "America/Denver",
                 "free_windows": evening_windows("C", 7)},
            ],
            "partner_preferences": [
                {"person_id": "A", "partner_id": "B",
                 "pref_ideal_hours": 8, "need_min_hours": 4, "pref_date_nights": 2},
                {"person_id": "A", "partner_id": "C",
                 "pref_ideal_hours": 8, "need_min_hours": 4, "pref_date_nights": 2},
                {"person_id": "B", "partner_id": "A",
                 "pref_ideal_hours": 10, "need_min_hours": 6, "pref_date_nights": 3},
                {"person_id": "C", "partner_id": "A",
                 "pref_ideal_hours": 6, "need_min_hours": 3, "pref_date_nights": 1},
            ],
        }
    )


def multi_pod_conflict() -> dict[str, Any]:
    """A is in Pod1 (with B) and Pod2 (with C); A has limited free time."""
    return _wrap(
        {
            "persons": [
                {"person_id": "A", "timezone": "America/Denver",
                 "free_windows": limited_windows("A", 4)},
                {"person_id": "B", "timezone": "America/Denver",
                 "free_windows": evening_windows("B", 7)},
                {"person_id": "C", "timezone": "America/Denver",
                 "free_windows": evening_windows("C", 7)},
            ],
            "partner_preferences": [
                {"person_id": "A", "partner_id": "B",
                 "pref_ideal_hours": 8, "need_min_hours": 3},
                {"person_id": "A", "partner_id": "C",
                 "pref_ideal_hours": 8, "need_min_hours": 3},
                {"person_id": "B", "partner_id": "A",
                 "pref_ideal_hours": 10, "need_min_hours": 5},
                {"person_id": "C", "partner_id": "A",
                 "pref_ideal_hours": 10, "need_min_hours": 5},
            ],
        }
    )


def oversubscribed() -> dict[str, Any]:
    """A has 4 partners, each wanting 8h. Total demand 32h, available ~20h."""
    persons: list[dict[str, Any]] = [
        {"person_id": "A", "timezone": "America/Denver",
         "free_windows": evening_windows("A", 7)},
    ]
    persons.extend(
        {"person_id": f"P{i}", "timezone": "America/Denver",
         "free_windows": evening_windows(f"P{i}", 7)}
        for i in range(1, 5)
    )

    prefs: list[dict[str, Any]] = []
    prefs.extend(
        {"person_id": "A", "partner_id": f"P{i}",
         "pref_ideal_hours": 8, "need_min_hours": 2}
        for i in range(1, 5)
    )
    prefs.extend(
        {"person_id": f"P{i}", "partner_id": "A",
         "pref_ideal_hours": 8, "need_min_hours": 2}
        for i in range(1, 5)
    )
    return _wrap({"persons": persons, "partner_preferences": prefs})


def timezone_mismatch() -> dict[str, Any]:
    """A in Denver, B in London, C in Tokyo — local evenings only."""
    return _wrap(
        {
            "persons": [
                {"person_id": "A", "timezone": "America/Denver",
                 "free_windows": evening_windows_tz("A", "America/Denver", 7)},
                {"person_id": "B", "timezone": "Europe/London",
                 "free_windows": evening_windows_tz("B", "Europe/London", 7)},
                {"person_id": "C", "timezone": "Asia/Tokyo",
                 "free_windows": evening_windows_tz("C", "Asia/Tokyo", 7)},
            ],
            "partner_preferences": [
                {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 4},
                {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 4},
            ],
        }
    )
