"""Candidate slot discovery for the optimizer.

For every partner pair, pod gathering, and subgroup, compute the windows in which
all participants are simultaneously free, then enumerate candidate blocks of each
admissible event-type duration. Locked blocks are subtracted from each person's
free slots before intersection.

See pod-life-technical-architecture.md § 7.3.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import OptimizationRequest, PartnerPreference


@dataclass(frozen=True)
class CandidateSlot:
    """A potential time block that the solver may select."""

    start_slot: int  # inclusive index into the discretized horizon
    end_slot: int  # exclusive
    duration_hours: float
    participant_ids: frozenset[str]
    event_type: str
    partnership_id: str | None = None
    pod_id: str | None = None
    # Optional metadata used by the solver for event-type counting.
    metadata: dict[str, str] = field(default_factory=dict, hash=False, compare=False)


def discover_candidate_slots(
    request: OptimizationRequest, horizon_slots: int
) -> list[CandidateSlot]:
    """Generate all candidate slots for the given request.

    Strategy:
        1. Build a per-person set of free slot indices from FreeWindow lists.
        2. Subtract locked-block slots from each affected person.
        3. For each partnership pair / pod / subgroup, intersect free sets,
           find contiguous runs, and slide event-type-sized windows across them.
    """
    slot_minutes = request.slot_duration_minutes
    candidates: list[CandidateSlot] = []

    # ── 1. Per-person free slot sets ────────────────────────────────────────
    person_free: dict[str, set[int]] = {}
    for person in request.persons:
        free_slots: set[int] = set()
        for window in person.free_windows:
            start_slot = int(
                (window.start - request.horizon_start).total_seconds() / 60 / slot_minutes
            )
            end_slot = int(
                (window.end - request.horizon_start).total_seconds() / 60 / slot_minutes
            )
            lo = max(0, start_slot)
            hi = min(horizon_slots, end_slot)
            if hi > lo:
                free_slots.update(range(lo, hi))
        person_free[person.person_id] = free_slots

    # ── 2. Subtract locked blocks ───────────────────────────────────────────
    for locked in request.locked_blocks:
        lock_start = int(
            (locked.start - request.horizon_start).total_seconds() / 60 / slot_minutes
        )
        lock_end = int(
            (locked.end - request.horizon_start).total_seconds() / 60 / slot_minutes
        )
        for pid in locked.participant_ids:
            if pid in person_free:
                for s in range(lock_start, lock_end):
                    person_free[pid].discard(s)

    # ── 3a. Pair candidates (partner relationships) ─────────────────────────
    # Deduplicate by unordered pair so we don't enumerate identical candidates
    # twice when both sides of a partnership submitted preferences.
    seen_pairs: set[frozenset[str]] = set()
    for pref in request.partner_preferences:
        pair_ids = frozenset([pref.person_id, pref.partner_id])
        if pair_ids in seen_pairs:
            continue
        seen_pairs.add(pair_ids)

        if not all(pid in person_free for pid in pair_ids):
            continue
        shared_free = person_free[pref.person_id] & person_free[pref.partner_id]
        if not shared_free:
            continue

        runs = _find_contiguous_runs(sorted(shared_free))
        partnership_id = _get_partnership_id(pref)
        for run_start, run_end in runs:
            run_length = run_end - run_start
            for et in request.event_types:
                # Pod Gathering / Sub-group are not 2-person events.
                if et.label in ("Pod Gathering", "Sub-group Hang"):
                    continue
                slots_needed = et.duration_minutes // slot_minutes
                if slots_needed <= 0 or run_length < slots_needed:
                    continue
                for offset in range(run_length - slots_needed + 1):
                    candidates.append(
                        CandidateSlot(
                            start_slot=run_start + offset,
                            end_slot=run_start + offset + slots_needed,
                            duration_hours=et.duration_minutes / 60,
                            participant_ids=pair_ids,
                            event_type=et.label,
                            partnership_id=partnership_id,
                        )
                    )

    # ── 3b. Pod gathering candidates ────────────────────────────────────────
    for pod_pref in request.pod_gatherings:
        member_ids = frozenset(pod_pref.member_ids)
        if not all(pid in person_free for pid in member_ids):
            continue

        members = list(member_ids)
        shared = set(person_free[members[0]])
        for pid in members[1:]:
            shared &= person_free[pid]
        if not shared:
            continue

        runs = _find_contiguous_runs(sorted(shared))
        slots_needed = int(pod_pref.duration_hours * 60 / slot_minutes)
        if slots_needed <= 0:
            continue
        for run_start, run_end in runs:
            run_length = run_end - run_start
            if run_length < slots_needed:
                continue
            for offset in range(run_length - slots_needed + 1):
                candidates.append(
                    CandidateSlot(
                        start_slot=run_start + offset,
                        end_slot=run_start + offset + slots_needed,
                        duration_hours=pod_pref.duration_hours,
                        participant_ids=member_ids,
                        event_type="Pod Gathering",
                        pod_id=pod_pref.pod_id,
                    )
                )

    # ── 3c. Subgroup candidates ─────────────────────────────────────────────
    for sub in request.subgroup_prefs:
        member_ids = frozenset(sub.member_ids)
        if not all(pid in person_free for pid in member_ids):
            continue

        members = list(member_ids)
        shared = set(person_free[members[0]])
        for pid in members[1:]:
            shared &= person_free[pid]
        if not shared:
            continue

        runs = _find_contiguous_runs(sorted(shared))
        slots_needed = int(sub.duration_hours * 60 / slot_minutes)
        if slots_needed <= 0:
            continue
        for run_start, run_end in runs:
            run_length = run_end - run_start
            if run_length < slots_needed:
                continue
            for offset in range(run_length - slots_needed + 1):
                candidates.append(
                    CandidateSlot(
                        start_slot=run_start + offset,
                        end_slot=run_start + offset + slots_needed,
                        duration_hours=sub.duration_hours,
                        participant_ids=member_ids,
                        event_type="Sub-group Hang",
                    )
                )

    return candidates


def _find_contiguous_runs(sorted_slots: list[int]) -> list[tuple[int, int]]:
    """Collapse a sorted list of slot indices into (start, end_exclusive) runs."""
    if not sorted_slots:
        return []

    runs: list[tuple[int, int]] = []
    run_start = sorted_slots[0]
    prev = sorted_slots[0]

    for slot in sorted_slots[1:]:
        if slot != prev + 1:
            runs.append((run_start, prev + 1))
            run_start = slot
        prev = slot

    runs.append((run_start, prev + 1))
    return runs


def _get_partnership_id(pref: PartnerPreference) -> str | None:
    return getattr(pref, "partnership_id", None)
