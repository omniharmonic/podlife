# Changelog

All notable changes to Pod Life will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — Security hardening & correctness

### Security

- **RLS is now a real backstop.** Postgres Row-Level Security was previously
  inert (never-set context, an open `= ''` policy branch, and a superuser
  connection that bypasses RLS). The app now connects as a dedicated
  non-superuser role; authenticated requests run inside a person-scoped
  transaction (`app.current_person_id`), while jobs/webhooks/cross-person
  aggregations use a service connection that bypasses RLS by design. Policies
  are deny-by-default. A no-context query now returns zero rows.
- **Cross-tenant authorization fixes.** `POST /schedule/reshuffle` now requires
  block participation; `POST /schedule/run` requires pod membership when a pod
  is targeted. Both were previously reachable by any authenticated user.
- **Login codes.** Per-email request throttling and invalidation of prior
  outstanding codes; raw email and code-bearing subject lines removed from logs.
- **Hardening.** Avatar uploads are validated by magic bytes (raster only; SVG
  rejected) and stored under unguessable keys. Cron and Telegram webhook secret
  checks use constant-time comparison.

### Fixed

- Optimizer "evening" (solo-rest constraint) is evaluated in each person's
  timezone instead of UTC, in both the inline TS solver and the Python
  reference.
- `GET /me/availability` returns 400 (not 500) on malformed ranges; datetime
  schemas accept timezone offsets, not only `Z`.
- `GET /schedule/proposals` now includes a participants array per block.

### Added

- Automated weekly cycle sweep: pods are triggered on their cadence
  (idempotent per period) instead of manual-only triggering.

---

## [0.1.0] — 2026-05-06 — First public release

The first end-to-end working release of Pod Life. Includes the full scheduling
flow from preferences to locked schedules, magic-link auth, calendar
integration with Google and Outlook, the maximin fairness optimizer, the PWA
frontend, optional Telegram bot, optional AI assistance, and privacy hardening.

### Added

- **Auth & data model.** Magic-link email authentication, Person/Partnership/Pod
  data model with canonical-ordered partnerships and PostgreSQL Row-Level
  Security policies on every relationship table.
- **Calendar integration.** Google Calendar OAuth, Microsoft (Outlook) OAuth,
  free/busy aggregation with adjacency merging, calendar event write-back with
  privacy-safe titles. iCloud (CalDAV) deferred to a later release.
- **Optimizer.** Python + FastAPI + HiGHS MILP solver implementing no-double-
  booking, hard minimums (needs), and maximin fairness across all relationships.
  Full polycule fixture suite including `multi_pod_conflict` and `oversubscribed`
  edge cases. Stateless service with no database access.
- **Scheduling cycle.** Collect preferences → optimize → propose → review →
  lock flow with reshuffle support for mid-cycle changes.
- **Frontend.** React 19 PWA with calendar, partners, pods, settings,
  proposal review, and invite-accept flows. Warm earth-tone palette per the
  PRD. Bottom navigation, mobile-first layout, page transitions, satisfaction
  ring animations, accessible focus rings throughout.
- **Welcome / landing page** at `/welcome` introducing the project to first-
  time visitors.
- **Telegram bot.** Optional. Group notifications, DM check-ins, schedule
  proposal links. Disabled cleanly when `TELEGRAM_BOT_TOKEN` is unset.
- **AI assistance.** Optional. Natural-language preference parsing, conflict
  explanations, satisfaction summaries. Disabled cleanly when
  `ANTHROPIC_API_KEY` is unset.
- **Privacy hardening.** Cross-pod invisibility test suite, privacy scrub
  middleware, Telegram privacy filters, optional privacy mode with scheduling
  jitter.
- **Open-source launch deliverables.** README, CONTRIBUTING, SECURITY,
  SELF_HOSTING guide, GitHub issue templates, PR template, AGPL-3.0 license,
  CI workflows, accessibility audit and test, production Docker compose,
  example Railway and Fly deployment recipes.

### Security

- AES-256-GCM encryption for all stored OAuth tokens.
- 32-byte hex `ENCRYPTION_KEY` required at boot.
- Webhook secret validation for Telegram.
- Row-Level Security policies enforced at the database layer as defense-in-
  depth against application-level bugs.

### Known limitations

- iCloud (CalDAV) integration is not yet shipped. Users with iCloud-only
  calendars can use manual availability entry as a fallback.
- The full preference editor (recurring holds, preferred windows, custom
  event types) ships as a simplified hours-per-week + date-night-count form
  for v1. Full editor is planned for v0.2.
- Encryption key rotation requires manual re-encryption; no in-app rotation
  flow yet.

### License

AGPL-3.0. See [LICENSE](./LICENSE).
