# Pod Life — Multi-Pod E2E Stress Report

_Generated 2026-05-08T06:40:10.822Z_

## Polycule shape
- **People:** 15
- **Partnerships:** 15
- **Pods:** 4 (Hearth, Garden, Volume, Council)
- **People in 2+ pods:** 5 (Aurelius in Hearth+Council, Beatrix in Hearth+Council, Florence in Garden+Council, Hadley in Garden+Council, Kestrel in Volume+Council)
- **Timezones:** 4 (America/Denver, America/New_York, Europe/London, America/Los_Angeles)

## Scenario: sequential

Total wall-clock: **381 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 10 | 86% | 71% | 5 | 0 | 0 | 166ms |
| Garden | 5 | 58% | 0% | 5 | 4 | 0 | 82ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 54ms |
| Council | 1 | 29% | 0% | 7 | 10 | 0 | 51ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.

## Scenario: concurrent

Total wall-clock: **176 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 10 | 86% | 71% | 5 | 0 | 0 | 166ms |
| Garden | 7 | 81% | 64% | 5 | 2 | 0 | 164ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 150ms |
| Council | 12 | 100% | 100% | 7 | 0 | 0 | 174ms |

**Cross-cycle collisions:** 18 between proposed blocks, 0 between locked blocks.

## Scenario: staggered

Total wall-clock: **1395 ms**

| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |
|---|---|---|---|---|---|---|---|
| Hearth | 10 | 86% | 71% | 5 | 0 | 0 | 76ms |
| Garden | 5 | 58% | 0% | 5 | 4 | 0 | 88ms |
| Volume | 0 | 0% | 0% | 4 | 7 | 0 | 85ms |
| Council | 1 | 29% | 0% | 7 | 10 | 0 | 116ms |

**Cross-cycle collisions:** 0 between proposed blocks, 0 between locked blocks.
