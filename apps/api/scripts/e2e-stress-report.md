# Pod Life — Multi-Pod E2E Stress Report

_Generated 2026-05-08T07:36:40.701Z_

## Polycule shape
- **People:** 15
- **Partnerships:** 15
- **Pods:** 4 (Hearth, Garden, Volume, Council)
- **People in 2+ pods:** 5 (Aurelius in Hearth+Council, Beatrix in Hearth+Council, Florence in Garden+Council, Hadley in Garden+Council, Kestrel in Volume+Council)
- **Timezones:** 4 (America/Denver, America/New_York, Europe/London, America/Los_Angeles)

## Scenario: sequential

Total wall-clock: **312 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 9 | 100% | 100% | 4 | 0 | 0 | 171ms |
| Garden | 5 | 83% | 64% | 4 | 2 | 0 | 52ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 36ms |
| Council | 0 | 0% | 0% | 5 | 7 | 0 | 26ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.

## Scenario: concurrent

Total wall-clock: **119 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 9 | 100% | 100% | 4 | 0 | 0 | 103ms |
| Garden | 5 | 83% | 64% | 4 | 2 | 0 | 106ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 95ms |
| Council | 0 | 0% | 0% | 5 | 7 | 0 | 117ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.

## Scenario: staggered

Total wall-clock: **1233 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 9 | 100% | 100% | 4 | 0 | 0 | 69ms |
| Garden | 5 | 83% | 64% | 4 | 2 | 0 | 52ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 40ms |
| Council | 0 | 0% | 0% | 5 | 7 | 0 | 34ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.
