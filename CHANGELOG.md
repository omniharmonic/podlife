# Changelog

All notable changes to Pod Life will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
