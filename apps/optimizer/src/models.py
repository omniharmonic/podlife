"""Pydantic v2 models for the Pod Life optimizer service.

Mirrors the API contract defined in pod-life-technical-architecture.md § 7.1.
Adds light validation: timezone strings must be IANA-recognized, durations are
non-negative, and per-partner needs cannot exceed preferred ideals.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EventType(BaseModel):
    """A schedulable event type (e.g. Date Night, Pod Gathering)."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1)
    duration_minutes: int = Field(gt=0)
    blocks_next_morning: bool = False


class FreeWindow(BaseModel):
    """A contiguous block of time when a person has no calendar conflicts."""

    model_config = ConfigDict(extra="forbid")

    start: datetime
    end: datetime

    @model_validator(mode="after")
    def _check_window(self) -> FreeWindow:
        if self.end <= self.start:
            raise ValueError("FreeWindow.end must be after FreeWindow.start")
        return self

    @property
    def duration_minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60.0


class PartnerPreference(BaseModel):
    """One side of a partnership's stated needs and preferences."""

    model_config = ConfigDict(extra="forbid")

    partner_id: str
    person_id: str
    partnership_id: str | None = None

    # Hard minimums (needs)
    need_min_hours: float = Field(default=0, ge=0)
    need_min_date_nights: int = Field(default=0, ge=0)
    need_min_overnights: int = Field(default=0, ge=0)

    # Soft targets (preferences)
    pref_ideal_hours: float = Field(default=0, ge=0)
    pref_date_nights: int = Field(default=0, ge=0)
    pref_overnights: int = Field(default=0, ge=0)
    pref_daytime_hangs: int = Field(default=0, ge=0)

    # Custom event types and timing hints (free-form for v1)
    custom_prefs: list[dict[str, Any]] = Field(default_factory=list)
    recurring_holds: list[dict[str, Any]] = Field(default_factory=list)
    preferred_windows: list[dict[str, Any]] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_need_le_pref(self) -> PartnerPreference:
        # If a person stated a preferred ideal, the hard need cannot exceed it.
        # If pref_ideal_hours is 0 (unspecified), we don't enforce the cap —
        # the architecture allows needs without an explicit ideal target.
        if self.pref_ideal_hours > 0 and self.need_min_hours > self.pref_ideal_hours:
            raise ValueError(
                "need_min_hours must not exceed pref_ideal_hours when both are set"
            )
        if self.pref_date_nights > 0 and self.need_min_date_nights > self.pref_date_nights:
            raise ValueError(
                "need_min_date_nights must not exceed pref_date_nights when both are set"
            )
        if self.pref_overnights > 0 and self.need_min_overnights > self.pref_overnights:
            raise ValueError(
                "need_min_overnights must not exceed pref_overnights when both are set"
            )
        if self.partner_id == self.person_id:
            raise ValueError("partner_id and person_id must differ")
        return self


class PodGatheringPref(BaseModel):
    """Pod-level preference for full-group gatherings."""

    model_config = ConfigDict(extra="forbid")

    pod_id: str
    member_ids: list[str] = Field(min_length=2)
    frequency: int = Field(ge=0)
    duration_hours: float = Field(gt=0)
    preferred_windows: list[dict[str, Any]] = Field(default_factory=list)


class SubgroupPref(BaseModel):
    """A subset of a pod that wants its own scheduled time."""

    model_config = ConfigDict(extra="forbid")

    label: str
    member_ids: list[str] = Field(min_length=2)
    frequency: int = Field(ge=0)
    duration_hours: float = Field(gt=0)
    preferred_windows: list[dict[str, Any]] = Field(default_factory=list)


class PersonSpec(BaseModel):
    """A person participating in this optimization run."""

    model_config = ConfigDict(extra="forbid")

    person_id: str
    timezone: str
    free_windows: list[FreeWindow] = Field(default_factory=list)
    solo_min_free_evenings: int = Field(default=0, ge=0)
    solo_min_free_weekend_days: int = Field(default=0, ge=0)

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Invalid IANA timezone: {v!r}") from exc
        return v


class LockedBlock(BaseModel):
    """An existing locked block that cannot be moved (used for reshuffles)."""

    model_config = ConfigDict(extra="forbid")

    start: datetime
    end: datetime
    participant_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_block(self) -> LockedBlock:
        if self.end <= self.start:
            raise ValueError("LockedBlock.end must be after LockedBlock.start")
        return self


class OptimizationRequest(BaseModel):
    """Full input to the /optimize endpoint."""

    model_config = ConfigDict(extra="forbid")

    horizon_start: datetime
    horizon_end: datetime
    persons: list[PersonSpec]
    partner_preferences: list[PartnerPreference]
    pod_gatherings: list[PodGatheringPref] = Field(default_factory=list)
    subgroup_prefs: list[SubgroupPref] = Field(default_factory=list)
    event_types: list[EventType]
    locked_blocks: list[LockedBlock] = Field(default_factory=list)
    slot_duration_minutes: int = Field(default=30, gt=0)

    @model_validator(mode="after")
    def _check_horizon(self) -> OptimizationRequest:
        if self.horizon_end <= self.horizon_start:
            raise ValueError("horizon_end must be after horizon_start")
        if not self.event_types:
            raise ValueError("event_types must not be empty")
        if not self.persons:
            raise ValueError("persons must not be empty")
        return self


class ProposedBlock(BaseModel):
    """A block the solver proposes for the schedule."""

    model_config = ConfigDict(extra="forbid")

    event_type: str
    start: datetime
    end: datetime
    participant_ids: list[str]
    partnership_id: str | None = None
    pod_id: str | None = None
    # person_id -> hours contributed to that person's satisfaction
    satisfaction_contribution: dict[str, float]


class SatisfactionScore(BaseModel):
    """Per-person satisfaction summary returned to the API caller."""

    model_config = ConfigDict(extra="forbid")

    person_id: str
    overall_pct: float
    # partner_id -> {"need_met": bool, "pref_pct": float, "hours_scheduled": float, ...}
    per_partner: dict[str, dict[str, Any]]
    unmet_needs: list[str]


class OptimizationResponse(BaseModel):
    """Full response from /optimize."""

    model_config = ConfigDict(extra="forbid")

    proposed_blocks: list[ProposedBlock]
    satisfaction_scores: list[SatisfactionScore]
    infeasibility_notes: list[str]
    solver_time_ms: int
    slot_count: int
    variable_count: int
