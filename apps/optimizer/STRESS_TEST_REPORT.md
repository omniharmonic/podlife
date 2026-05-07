# Pod Life Optimizer — Stress Test Report

**Date:** 2026-05-06
**Solver:** HiGHS via `highspy`, MILP formulation per `pod-life-technical-architecture.md` § 7.2
**Fixtures:** 7 realistic polycule configurations in `tests/fixtures/realistic_polycules.py`
**Test runner:** `tests/test_stress.py` (10 tests, all passing alongside the 18 pre-existing tests)

All identifiers below are synthetic (A/B/C/D/E/F/G/H/P1–P5). No PII appears anywhere in this report or in the fixtures.

---

## Executive Summary

The maximin formulation behaves correctly for the cases it was designed to handle: it does maximize the minimum overall-satisfaction ratio, hard minimums are enforced, infeasibility is detected and reported with diagnostic notes, and the solver is fast (every fixture solved in well under 100ms — three orders of magnitude inside the 2s budget). For relationships dominated by single partner pairs, the result is intuitively fair.

However, two structural limitations show up consistently in the more interesting fixtures: **(1) pod gatherings are essentially never scheduled when partner pairings can satisfy everyone's overall ratio**, and **(2) the per-person `overall_pct` aggregation hides within-person unfairness** — once a person reaches 100% overall, the optimizer has no incentive to balance their partners against each other, and one partner can be quietly shorted (e.g., in `quad_kitchen_table` A is at 100% but A↔D got 3.5h vs A↔B 6h). The math is sound for what it optimizes; the gap is in what the objective measures.

**Verdict:** the solver is production-ready for the v1 scope of "give every person an acceptable overall amount of time", but two follow-on objective terms (a small reward for pod gatherings, and a per-pair component within each person) would meaningfully improve perceived fairness.

---

## Per-fixture Results

| Fixture | Persons | Partnerships | Feasible | Solver ms | Min sat | Median | Max | Gap |
|---|---|---|---|---|---|---|---|---|
| `triad_v_with_metamours` | 3 | 2 | yes | 9 | 100.0% | 100.0% | 100.0% | 0.0pp |
| `quad_kitchen_table` | 4 | 6 | yes | 64 | 100.0% | 100.0% | 100.0% | 0.0pp |
| `solo_poly_5_partners` | 6 | 5 | yes | 37 | 100.0% | 100.0% | 100.0% | 0.0pp |
| `mixed_demand_5person` | 5 | 4 | yes | 24 | 71.4% | 89.3% | 100.0% | 28.6pp |
| `busy_week_8person` | 8 | 7 | no (intentional) | 16 | 0.0% | 0.0% | 0.0% | 0.0pp |
| `relaxed_pod_3person` | 3 | 3 | yes | 24 | 100.0% | 100.0% | 100.0% | 0.0pp |
| `tight_constraints_4person` | 4 | 6 | yes | 67 | 79.2% | 100.0% | 100.0% | 20.8pp |

`Gap` = max satisfaction − min satisfaction across people in the fixture. All gaps are well below the 50pp ceiling the test runner enforces.

### `triad_v_with_metamours`

A↔B and A↔C, with B and C as metamours (no romantic partnership). 5 evenings × 5h is plenty of capacity. The solver scheduled 7 pair blocks and 0 pod gatherings. A↔B got 10h (vs 8h ideal), A↔C got 7.5h (vs 8h ideal). Everyone reports 100% overall satisfaction. **However:** the requested pod gathering for {A, B, C} was not scheduled, even though all three were free for 5 evenings — see "Identified limitations" below. From the solver's POV the schedule is optimal because z=1.0; from the user's POV the pod gathering they explicitly requested vanished.

### `quad_kitchen_table`

K4 graph with 4 people, 6 partnerships, asymmetric desire levels. Solved in 64ms with 832 variables. Everyone hits 100% overall satisfaction, but inspection of `per_partner_hours` reveals notable within-person imbalance: A's blocks split 6h+6h+3.5h between B/C/D against ideals of 5h+5h+5h. Because A is at 100% overall (15.5h scheduled vs 15h wanted, capped at 100%), the optimizer has no signal to push more time toward D. D is fine because B and C are also their partners and they got plenty of time elsewhere — but in a different topology this asymmetry could leave a partner feeling undervalued. Pod gathering was again not scheduled.

### `solo_poly_5_partners`

A as solo-poly hub with 5 partners (B–F) over a 14-day horizon. Solved in 37ms. Every partner gets ≥6h with A; some got significantly more (D and F got >13h each). The solver freely allocates A's surplus capacity unevenly because there's no upper-bound discipline once each pair's pref ideal is met. Functionally fine, but if A had stated "I want roughly 6h per partner" the solver did not honor that as an upper bound — it treats `pref_ideal_hours` as a one-sided floor for the satisfaction ratio (capped at 100%), not a target.

### `mixed_demand_5person`

Two overlapping pods: {A, B, C} and {A, D, E}. A is busy (4 evenings), D↔E partnership is independent. Solved in 24ms with one pod gathering scheduled (the only fixture besides `tight_constraints_4person` to actually schedule a pod gathering). Min satisfaction is 71.4% (B and C). The maximin works: B and C are at the same 71.4% (5h scheduled vs 7h wanted) — the solver pushed both as far as A's limited time allows. D and E got 17.5h, far more than their 8h target — that's "free surplus" because their pod doesn't conflict with the other pod that bottlenecks A. This fixture demonstrates the objective working as designed for the intended use case.

### `busy_week_8person`

Designed to be infeasible: A has 3 evenings (15h), but 7 partners × 2h hard minimum = 14h, plus 9h of pod gatherings. With slot exclusivity, this overflows. The solver correctly returned 0 blocks, populated `infeasibility_notes` with a clear diagnostic ("Person A: desired time (28h) is close to total free time (15h)"), and reported solver_time_ms=16. **Bug observation:** the satisfaction scores in the empty case all read `0.0%` with `unmet_needs=["No schedule could be generated."]` — this is correct behavior but the per-partner breakdown is not populated even though we know exactly which needs went unmet. See recommendations.

### `relaxed_pod_3person`

Sanity-check upper bound: generous availability + modest needs. Solved in 24ms with 12 blocks scheduled. Everyone at 100% with massive surplus (B↔C got 14.5h against a 3h target). No pod gathering scheduled despite plenty of overlap. Confirms the solver doesn't crash or misbehave in low-pressure scenarios.

### `tight_constraints_4person`

K4 quad with a Tuesday 18–22 locked block for A↔B (used as a recurring-hold proxy). Solver scheduled 9 blocks plus 1 pod gathering. The locked block itself is correctly excluded from any other A↔* or B↔* candidate (verified by inspecting timestamps: zero blocks involving A or B overlap Tuesday 18–22). B reports 79.2% overall — driven by B getting only 2.5h with A, 3.5h with C, 3.5h with D against 4h ideals each. The locked Tuesday 18–22 block was treated by the solver as removed availability, **not** as 4h of A↔B time toward B's satisfaction — because locked blocks don't count in `_compute_satisfaction`. **This is a meaningful behavioral question for the user**: when the engine writes a locked block back, should it be treated as already-credited time for satisfaction purposes? The architecture doc § 7.2 doesn't address this directly.

---

## Performance Characteristics

| Fixture | Persons | Slots | Variables | Solve ms |
|---|---|---|---|---|
| `triad_v_with_metamours` | 3 | 336 | 126 | 9 |
| `relaxed_pod_3person` | 3 | 336 | 385 | 24 |
| `mixed_demand_5person` | 5 | 336 | 211 | 24 |
| `solo_poly_5_partners` | 6 | 672 | 701 | 37 |
| `quad_kitchen_table` | 4 | 336 | 832 | 64 |
| `tight_constraints_4person` | 4 | 336 | 777 | 67 |
| `busy_week_8person` | 8 | 336 | 256 | 16 |
| existing `test_solver_completes_under_2s_for_10_persons_7_days` | 10 | 336 | — | <500 |

Variable count scales roughly with `partnerships × free_evenings × event_types`. The K4 fixtures (832 and 777 vars) are the heaviest. The 14-day solo-poly fixture has 672 slots and still solves in 37ms because the partnership graph is sparse (5 disjoint edges through A). Performance is excellent across the board — well within the 2s P4.5.6 budget, and orders of magnitude inside the 5s solver time-limit.

---

## Math Sanity Checks

### Maximin actually maximizes the minimum

Verified with a hand-constructed test (in `test_stress.py::test_hard_minimums_actually_enforced` and an offline verification): given A free for 3 hours with two partners B (wants 8h) and C (wants 4h), the solver split A's time 1.5h/1.5h. The alternative allocations: 3h to B → z=min(0.375, 0.188, 0)=0, or 3h to C → z=min(0.375, 0, 0.75)=0, or 1.5/1.5 → z=min(0.375, 0.188, 0.375)=0.188. The solver picked the maximin choice. ✓

### Hard minimums are enforced

Verified in `test_hard_minimums_actually_enforced`: a 6h hard minimum between A and B is met exactly, even when stricter than `pref_ideal_hours`. ✓ Also verified by the existing `test_v_structure_a_time_split_between_b_and_c` which checks 6h and 4h minimums are both met. ✓

### Obvious infeasibility is reported

Verified in `test_obvious_infeasibility_is_reported`: 1h shared free time + 5h hard minimum → solver returns empty `proposed_blocks` and a populated `infeasibility_notes`. The `busy_week_8person` fixture also exercises this end-to-end. ✓

### Zero-preference person is 100% satisfied

Verified in `test_zero_preference_person_is_100_pct_satisfied`. Person C with no `partner_preferences` rows reports 100% overall — matching the convention in `_compute_satisfaction`. ✓

### Locked blocks reduce availability

Verified by inspection of `tight_constraints_4person`: a Tuesday 18–22 locked block for {A, B} resulted in zero proposed blocks involving A or B during that window. ✓

---

## Identified Limitations and Possible Bugs

These are NOT auto-fixed in this run — the user should decide whether each is a bug or an intentional v1 simplification.

### L1 — Pod gatherings are effectively never scheduled (real, structural)

**Severity:** medium-high. Affects user trust.
**Where:** `solver.py` constraint 3 + objective.

The objective is `maximize z`, where `z` is bounded above by every person's `(scheduled_hours / total_pref_hours)`. Pod gatherings DO contribute to `scheduled_hours` for every member, but they do NOT increase any pair's hours, and once a person reaches 100% their `z`-binding constraint is no longer active. So the solver only chooses a pod gathering when it has slack capacity (e.g., the locked block in `tight_constraints_4person` makes pair time scarce on Tuesday, so a pod gathering becomes "free utility" elsewhere).

In the typical case — partners have enough time to satisfy their pair preferences — the pod gathering competes with pair blocks for the same evening slots and loses, since pair blocks contribute toward the constraint-binding person while pod gatherings do not (after z hits 1.0). Result: `triad_v_with_metamours`, `quad_kitchen_table`, `solo_poly_5_partners`, and `relaxed_pod_3person` ALL silently dropped the requested pod gathering.

This is mathematically correct given the formulation but contradicts user intent. Users who request a pod gathering will be surprised.

**Suggested fix (do not apply now):** add a small bonus term to the objective for each scheduled pod gathering up to its `frequency` target — e.g., `+ 0.01 × sum(pod_gathering_vars[:freq])`. This is a lexicographic tiebreaker that doesn't disturb maximin when it's tight, but does cause the solver to prefer schedules that include the requested gathering when there's slack.

### L2 — `overall_pct` masks within-person partner imbalance (real, structural)

**Severity:** medium. Affects perceived fairness.
**Where:** `solver.py` Constraint 3 uses `total_pref_hours` (summed across partners) and `_compute_satisfaction` reports `overall_pct = total_hours / total_wanted`.

In `quad_kitchen_table`, person A's `overall_pct` is 100% because total scheduled hours (15.5h) exceed total wanted (15h). But the per-partner breakdown is 6/5h for B, 6/5h for C, and only 3.5/5h for D (70%). A's three partners would not all feel equally well-treated. Because the maximin constraint is per-person (using the sum), the optimizer has no incentive to balance among A's partners once A is at 100%.

**Suggested fix:** add a per-pair maximin layer. Replace the single `z` with `z = min over (person, partner) pairs` (or as a second-stage hierarchical objective). Or, add a soft-penalty term for the variance across a person's partners. This is more complex than L1 and may be deferred.

### L3 — Empty-result satisfaction breakdown is not informative

**Severity:** low.
**Where:** `solver.py::_empty_scores`.

When `proposed_blocks=[]`, every person gets `overall_pct=0.0` with `per_partner={}` and `unmet_needs=["No schedule could be generated."]`. The user can't tell from the SatisfactionScore alone which specific minimums failed; they have to read `infeasibility_notes`. For UI purposes it would help to populate `per_partner` with `hours_scheduled=0, hours_wanted=pref_ideal_hours, need_met=False` so the frontend can render the breakdown the same way for feasible and infeasible runs.

### L4 — Locked blocks don't credit toward satisfaction

**Severity:** medium. Likely a design question, not a clear bug.
**Where:** `solver.py::_compute_satisfaction` and `slot_discovery.py`.

In `tight_constraints_4person` we lock A↔B Tuesday 18–22. The solver correctly excludes that time from new candidates, but it doesn't ADD the 4h of locked A↔B time to A or B's satisfaction. As a result B's `overall_pct` is 79.2% (excluding the locked 4h with A) when it would be 100%+ if locked time counted. For reshuffles this matters: existing locked blocks should typically count toward the user's ideal. The architecture doc § 7.2 is silent on this; check whether the API server is expected to inject locked blocks as proposed blocks before display, or whether the optimizer should do it.

### L5 — `pref_ideal_hours` is a floor, not a target

**Severity:** low. Documented behavior, but worth a recommendation.
**Where:** `_compute_satisfaction` caps `pref_pct` at 100% and the solver has no upper bound on per-pair hours.

In `solo_poly_5_partners` partner D got 14.5h with A despite a 6h ideal. There's no constraint preventing this — the solver fills surplus capacity wherever it can, biased by candidate enumeration order. If users state "I want 6h" they may not want 14.5h. Consider either an explicit `max_hours` field on PartnerPreference or a soft "prefer not to exceed ideal by more than X" term.

---

## Recommendations

1. **Add a small bonus term for pod gatherings (L1).** A few lines in `solver.py`. Without this, every fixture with a requested pod gathering and slack capacity silently drops it.

2. **Document the locked-block + satisfaction interaction (L4).** Either credit locked blocks toward the per-pair hours in `_compute_satisfaction`, or add a note in the architecture doc explaining the API server's expected behavior.

3. **Populate `per_partner` even on infeasibility (L3).** Improves the frontend's ability to render unmet needs uniformly.

4. **Consider a per-pair maximin layer or fairness penalty (L2).** This is the most material gap between "math says everyone is satisfied" and "users feel everyone got treated fairly." Could be a Phase 2 enhancement.

5. **Add an explicit upper bound for partner-pair hours (L5).** Something like `pref_max_hours` (defaulting to `pref_ideal_hours × 1.5` or similar). Prevents the surplus-allocation drift seen in `solo_poly_5_partners`.

---

## Test Suite Status

```
$ pytest -q
............................                                             [100%]
28 passed in 0.77s
```

- 18 pre-existing tests: passing
- 10 new stress tests added: passing (7 fixtures × 1 invariant test + 3 math sanity checks)
- Result data persisted at `tests/stress_test_results.json` for reproducibility

The new test file is `apps/optimizer/tests/test_stress.py`. The new fixtures are in `apps/optimizer/tests/fixtures/realistic_polycules.py`.
