# Multi-Pod E2E Stress — Findings

**Date:** 2026-05-08
**Setup:** 15 people, 15 partnerships, 4 overlapping pods (Hearth, Garden, Volume, Council), 4 timezones (Denver, NYC, London, LA), three scenarios (sequential / concurrent / staggered).

## Headline numbers (after fixes)

| pod | members | sequential | concurrent | staggered |
|---|---|---|---|---|
| Hearth | 4 (close-knit core) | 10 / 86% / 71% | 10 / 86% / 71% | 10 / 86% / 71% |
| Garden | 4 (second household) | 5 / 58% / 0% | **7 / 81% / 64%** | 5 / 58% / 0% |
| Volume | 4 (TZ-split solo cluster) | 0 / 0% / 0% | 0 / 0% / 0% | 0 / 0% / 0% |
| Council | 5 (bridge pod) | 1 / 29% / 0% | **12 / 100% / 100%** | 1 / 29% / 0% |
| **cross-cycle collisions** |  | 0 | **18** | 0 |

`blocks / mean satisfaction / min satisfaction`

## Bugs found and fixed

### 1. Cycle persistence non-idempotent → every cycle ran twice

**Root cause:** `processCycleJob` mutated state unconditionally. The BullMQ queue retries (`attempts: 3`), the QStash native retry policy, *and* the synchronous `/_test/run-now` test backdoor all dispatch the same `cycleId`. A retry after a successful first run double-inserted every proposed block, with all participants doubly-assigned. The stress test surfaced it as `0 self-collisions` in the post-fix run vs. `10 self-collisions per Hearth cycle` pre-fix — exactly the magnitude of a 2× duplication.

**Fix** (`apps/api/src/modules/schedule/cycle.manager.ts:139–169`): Added a status-guarded atomic claim. The cycle must be in `'collecting'`; the `UPDATE … SET status='optimizing' WHERE status='collecting' RETURNING` returns 0 rows when another worker beat us to it, and the second caller bails with `{ ok: true, skipped: true }`.

**Regression test** (`apps/api/tests/cycle-idempotency.test.ts`): two tests — one that asserts a cycle past `collecting` is skipped, and one that races two `processCycleJob` calls on the same `cycleId` and asserts exactly one ran.

### 2. Satisfaction percentage scale mismatch → rings always read 100%

**Root cause:** the solver returns `overall_pct` and `pref_pct` on a **0–100 scale** (`solver.ts:584`, `562`). Five frontend sites were multiplying by 100 again before passing to `<SatisfactionRing>`, which clamps to `[0,100]`. Anything > 1% on the real scale rendered as 100%. The stress runner displayed the same bug as `8606%` / `10000%` because it inherited the `* 100`.

**Fix:** dropped the `* 100` at:
- `apps/web/src/pages/HomePage.tsx:189`
- `apps/web/src/pages/CalendarPage.tsx:77, 149`
- `apps/web/src/pages/PartnerDetailPage.tsx:90`
- `apps/web/src/pages/PartnersPage.tsx:93`
- `apps/web/src/pages/ProposalReviewPage.tsx:142, 159`

The stress runner's display logic was updated to match.

### 3. Stress fixture polluted the DB → telegram-privacy test flaked

**Root cause:** the privacy filter substring-matches person names from the DB to detect cross-pod leakage in messages. Leftover `Beatrix` from the stress run substring-matched `Beatrice` in the unrelated test message, breaking that test.

**Fix:** stress runner now cleans up after itself (`nukeStressData()` at end of `main()`).

**Follow-up worth noting (not fixed):** the substring match is itself fragile — a real user named "Bea" in someone else's pod would always trip the filter for any message mentioning "Beach", "Beatrice", etc. The privacy filter should match whole words, not substrings. Filed as a footnote, not in scope today.

## The cycle-timing finding

This is the load-bearing insight from the stress run.

**Concurrent execution silently over-promises by 18 cross-cycle collisions.** When all four pod cycles run in parallel:
- Each cycle's `loadLockedBlocks(cycleId)` only sees blocks from *other* cycles that are already `'locked'` — proposed blocks from a parallel cycle are invisible.
- Council (the cross-pod bridge with members in Hearth, Garden, and Volume) finds every window "free" because Hearth/Garden's proposals haven't moved past `proposed` status yet.
- Council reports 100% satisfaction with 12 blocks.
- 18 of those blocks overlap with Hearth or Garden proposals on shared participants.

**Sequential / staggered execution under-schedules** because we assume "all participants accept" by locking proposals between cycles. With only 1 block fitting in Council after Hearth+Garden lock prime windows, Council members appear stranded — but in reality not all proposals get accepted, so the locking is too aggressive too.

**The product gap:** there's no intermediate "tentatively claimed" state between `proposed` and `locked`. Today the optimizer treats only fully-accepted blocks as binding, which is correct for accepting/declining but means a parallel cycle has nothing to look at. Two reasonable directions to consider (not implementing now — wanted your read first):

1. **Add a `claimed` status.** When a cycle finishes proposing, its blocks move to `claimed`. Other cycles see claimed blocks as soft-busy (subtract from candidate slots, but don't error if accept/decline ratio later forces re-evaluation). Locked is still the terminal state.

2. **Per-person cycle locking via Redis.** Before optimizing, acquire a Redis lock for each `personId` in the cycle. A second cycle for an overlapping pod waits for the first to either complete-and-claim or error-and-release. Adds latency under concurrent load but guarantees serial views of "what's already promised".

(1) is more honest about the proposal lifecycle and lets concurrent cycles coexist with eventual consistency. (2) is simpler to reason about but serializes work that doesn't have to be serial.

## What the optimizer got right

- **No double-booking constraint holds** — 0 self-collisions inside any single cycle across all three scenarios (after the persistence fix).
- **Hard minimums respected** — every cycle that produced blocks met the `need_min_hours` for at least one partner per pod even when others fell below their `pref_ideal_hours`.
- **Maximin fairness visible** — Hearth's worst-served pair lands at 71%, mean 86%; Garden falls to 0% on its TZ-misaligned pair (Florence↔Hadley overlap is fine but Florence↔Aurelius cross-household connection competes for the same evenings).
- **Infeasibility correctly diagnosed** — Volume produces 7 infeasibility notes naming the K↔L (London/Denver) pair; the optimizer doesn't pretend to find time that doesn't exist.

## Things I noticed but didn't act on

- **Privacy-filter substring matching** (mentioned above) — flag for follow-up.
- **Test gates on HTTP optimizer** — `tests/schedule.test.ts:25` skips when `OPTIMIZER_URL/health` is unreachable, but the runtime now defaults to inline WASM. The skip should be removed and the test made unconditional.
- **`getInvolvedPersonIds` over-broadens cycles** — when triggered with a `podId`, it adds the trigger person's *all* active partners (even those not in the pod). For a Council cycle, that drags 7 people into a 5-person pod scope. Reasonable for "schedule my whole life", surprising if the user thinks they're scheduling just this pod. Worth a UX clarification, not an immediate code fix.

## Files added / changed in this work

- `apps/api/src/modules/schedule/cycle.manager.ts` — idempotency guard
- `apps/web/src/pages/{Home,Calendar,Partners,PartnerDetail,ProposalReview}*.tsx` — drop `* 100`
- `apps/api/scripts/e2e-stress.ts` — stress runner (`pnpm --filter @pod-life/api e2e:stress`)
- `apps/api/scripts/e2e-stress-report.md` — auto-generated stress report
- `apps/api/scripts/e2e-diagnose.ts` — single-pod diagnostic dump
- `apps/api/tests/cycle-idempotency.test.ts` — regression for bug #1
