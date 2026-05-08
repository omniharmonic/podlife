# Pod Life — Multi-Pod E2E Stress Report

_Generated 2026-05-08T07:02:13.100Z_

## Polycule shape
- **People:** 15
- **Partnerships:** 15
- **Pods:** 4 (Hearth, Garden, Volume, Council)
- **People in 2+ pods:** 5 (Aurelius in Hearth+Council, Beatrix in Hearth+Council, Florence in Garden+Council, Hadley in Garden+Council, Kestrel in Volume+Council)
- **Timezones:** 4 (America/Denver, America/New_York, Europe/London, America/Los_Angeles)

## Scenario: sequential

Total wall-clock: **289 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 9 | 100% | 100% | 4 | 0 | 0 | 161ms |
| Garden | 5 | 83% | 64% | 4 | 2 | 0 | 47ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 35ms |
| Council | 0 | 0% | 0% | 5 | 7 | 0 | 20ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.

## Scenario: concurrent

Total wall-clock: **111 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 9 | 100% | 100% | 4 | 0 | 0 | 105ms |
| Garden | 5 | 83% | 64% | 4 | 2 | 0 | 108ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 98ms |
| Council | 6 | 98% | 92% | 5 | 0 | 0 | 109ms |

**Cross-cycle collisions:** 6 between proposed blocks, 0 between locked blocks.

## Scenario: staggered

Total wall-clock: **1233 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 9 | 100% | 100% | 4 | 0 | 0 | 64ms |
| Garden | 5 | 83% | 64% | 4 | 2 | 0 | 61ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 36ms |
| Council | 0 | 0% | 0% | 5 | 7 | 0 | 33ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.
