# Pod Life — Implementation Plan

**Author:** Benjamin Life (@omniharmonic)
**Version:** 0.1.0
**Date:** May 2026
**Status:** Pre-Implementation

---

## How to Read This Document

Every task follows this format:

```
[TASK_ID] Task Name
  Arch Ref: § Section(s) in the Technical Architecture Document
  Depends On: TASK_ID(s) that must be complete before this can start
  Estimated Effort: in developer-days (1 day = ~6 focused hours)
  Deliverable: what "done" looks like
```

Dependency notation:

- **Hard dependency** (`→`): Cannot start until the upstream task is fully complete.
- **Soft dependency** (`⇢`): Can start in parallel but needs the upstream task's interface/contract defined (not necessarily implemented).
- **None**: Can start immediately with no prerequisites.

Phase boundaries are checkpoints. Each phase ends with a **milestone** — a concrete, demonstrable capability that proves the phase is complete before moving on.

---

## Phase Overview

| Phase | Name | Duration | Cumulative | Milestone |
|-------|------|----------|------------|-----------|
| P0 | Project Scaffolding | 4 days | Week 1 | Monorepo builds, deploys locally, CI passes |
| P1 | Data Model & Auth | 8 days | Weeks 2–3 | User can sign up, log in, connect a calendar |
| P2 | Relationship Graph | 6 days | Weeks 3–4 | User can create partnerships and pods, set preferences |
| P3 | Calendar Integration | 7 days | Weeks 5–6 | Free/busy windows pulled and aggregated across providers |
| P4 | Optimization Engine | 10 days | Weeks 7–8 | Solver produces valid schedules for all test fixtures |
| P5 | Scheduling Cycle | 8 days | Weeks 9–10 | End-to-end cycle: collect → optimize → propose → lock |
| P6 | Frontend Core | 12 days | Weeks 11–13 | PWA with calendar view, preference editor, proposal review |
| P7 | Telegram Integration | 5 days | Weeks 14–15 | Bot sends proposals, accepts responses, posts to pod groups |
| P8 | AI Layer | 5 days | Weeks 15–16 | NL preference parsing, schedule explanation, reshuffle requests |
| P9 | Privacy Hardening | 4 days | Week 17 | All privacy boundary tests pass, audit complete |
| P10 | Polish & Launch Prep | 8 days | Weeks 18–20 | Open source repo, self-hosting docs, reference deployment live |

**Total estimated effort:** ~77 developer-days across 20 weeks.
At half-time pace (~3 days/week of focused dev), this is a ~26-week timeline.
At full-time pace, the 20-week estimate holds.

---

## Phase 0: Project Scaffolding

**Goal:** A working monorepo with all three apps stubbed, local dev environment running, and CI pipeline passing.

**Duration:** 4 days

---

### [P0.1] Initialize Monorepo

**Arch Ref:** § 3 (Repository Structure)
**Depends On:** None
**Effort:** 1 day
**Deliverable:** Turborepo monorepo with three app stubs that build and lint cleanly.

Sub-tasks:

- [P0.1.1] Initialize Turborepo with `apps/api`, `apps/web`, `apps/optimizer`, and `packages/shared`
- [P0.1.2] Configure TypeScript (`tsconfig.json`) for API and web apps with strict mode and path aliases
- [P0.1.3] Configure ESLint and Prettier with shared config across all TypeScript packages
- [P0.1.4] Set up Python project in `apps/optimizer` with `pyproject.toml`, virtual environment, and `ruff` linter
- [P0.1.5] Create `packages/shared` with initial type definitions and Zod schemas for enums (`partnership_status`, `scheduling_cadence`, `time_block_status`, etc.) per § 4.2
- [P0.1.6] Verify `turbo build`, `turbo lint`, and `turbo test` all pass with empty test suites

---

### [P0.2] Docker Compose Local Dev Environment

**Arch Ref:** § 14.1 (Docker Compose)
**Depends On:** P0.1
**Effort:** 1 day
**Deliverable:** `docker-compose up` starts PostgreSQL, Redis, API, optimizer, and web app.

Sub-tasks:

- [P0.2.1] Write `Dockerfile` for `apps/api` (Node.js 22 Alpine, multi-stage build)
- [P0.2.2] Write `Dockerfile` for `apps/optimizer` (Python 3.12 slim, HiGHS installed)
- [P0.2.3] Write `Dockerfile` for `apps/web` (Vite build → nginx serve)
- [P0.2.4] Write `docker-compose.yml` with PostgreSQL 16, Redis 7, API, optimizer, and web services per § 14.1
- [P0.2.5] Create `.env.example` with all required environment variables per § 14.2
- [P0.2.6] Add health check endpoints to API (`/health`) and optimizer (`/health`) per § 7.4
- [P0.2.7] Verify full stack starts, health checks pass, and services can reach each other

---

### [P0.3] CI Pipeline

**Arch Ref:** § 15 (Testing Strategy)
**Depends On:** P0.1, P0.2
**Effort:** 1 day
**Deliverable:** GitHub Actions workflow that runs lint, type-check, and tests on every PR.

Sub-tasks:

- [P0.3.1] Create `.github/workflows/ci.yml` with jobs for: lint, typecheck, test (API), test (optimizer), test (web)
- [P0.3.2] Configure PostgreSQL and Redis service containers for API integration tests
- [P0.3.3] Add Docker build verification step (ensures all Dockerfiles build successfully)
- [P0.3.4] Add branch protection rules requiring CI pass before merge

---

### [P0.4] API Application Shell

**Arch Ref:** § 8.1 (API Application Setup)
**Depends On:** P0.1
**Effort:** 1 day
**Deliverable:** Hono API server with middleware, error handling, and request logging.

Sub-tasks:

- [P0.4.1] Initialize Hono application in `apps/api/src/app.ts` with CORS, logger, and secure headers per § 8.1
- [P0.4.2] Set up rate limiting middleware per § 8.1
- [P0.4.3] Create error handling middleware with structured error responses
- [P0.4.4] Create `lib/config.ts` with typed environment variable loading and validation
- [P0.4.5] Create `lib/redis.ts` with Redis connection singleton
- [P0.4.6] Set up Vitest for API tests with test utilities (factory functions, DB cleanup)

---

**Phase 0 Milestone:** Running `docker-compose up` starts all services. The API responds to `/health`. CI passes. The optimizer responds to `/health`. The web app loads a blank page.

---

## Phase 1: Data Model & Auth

**Goal:** Users can create accounts via magic link, log in, and connect a Google Calendar.

**Duration:** 8 days

---

### [P1.1] Database Schema & Migrations

**Arch Ref:** § 4.2 (Complete Schema), § 4.3 (Row-Level Security)
**Depends On:** P0.2 (PostgreSQL running), P0.4 (API shell)
**Effort:** 2 days
**Deliverable:** All tables created with indexes, triggers, and RLS policies. Seed data for default event types.

Sub-tasks:

- [P1.1.1] Install and configure Drizzle ORM with PostgreSQL driver
- [P1.1.2] Define Drizzle schema for `persons` table with all columns per § 4.2
- [P1.1.3] Define Drizzle schema for `magic_links` and `sessions` tables per § 4.2
- [P1.1.4] Define Drizzle schema for `calendar_connections` table per § 4.2
- [P1.1.5] Define Drizzle schema for `partnerships` and `partnership_preferences` tables per § 4.2
- [P1.1.6] Define Drizzle schema for `pods`, `pod_members`, and `pod_preferences` tables per § 4.2
- [P1.1.7] Define Drizzle schema for `event_types` table with seed data per § 4.2
- [P1.1.8] Define Drizzle schema for `scheduling_cycles`, `time_blocks`, and `time_block_participants` tables per § 4.2
- [P1.1.9] Define Drizzle schema for `notifications` and `audit_log` tables per § 4.2
- [P1.1.10] Create `updated_at` trigger function per § 4.2
- [P1.1.11] Write initial migration (`0001_initial_schema.sql`)
- [P1.1.12] Implement RLS policies for `partnerships`, `pod_members`, and `time_blocks` per § 4.3
- [P1.1.13] Write seed script for default event types (Date Night, Overnight, Daytime Hang, Pod Gathering, Sub-group Hang)
- [P1.1.14] Verify migration runs cleanly on fresh database, seed completes, and rollback works

---

### [P1.2] Encryption Service

**Arch Ref:** § 13.1 (Encryption at Rest)
**Depends On:** P0.4
**Effort:** 0.5 days
**Deliverable:** `encrypt()` and `decrypt()` functions using AES-256-GCM, tested and working.

Sub-tasks:

- [P1.2.1] Implement `vault.ts` with `encrypt()` and `decrypt()` per § 13.1
- [P1.2.2] Add `ENCRYPTION_KEY` validation at startup (must be 32-byte hex)
- [P1.2.3] Write unit tests: encrypt/decrypt roundtrip, invalid key rejection, tampered ciphertext detection

---

### [P1.3] Magic Link Auth

**Arch Ref:** § 5.1 (Authentication Flow)
**Depends On:** P1.1 (schema), P1.2 (encryption)
**Effort:** 2 days
**Deliverable:** User can request a magic link, click it, and receive a session token.

Sub-tasks:

- [P1.3.1] Implement `requestMagicLink()` per § 5.1 — token generation, hashing, storage, email send
- [P1.3.2] Set up email transport (Nodemailer with SMTP or Resend API) with HTML templates
- [P1.3.3] Implement `verifyMagicLink()` per § 5.1 — token validation, person find-or-create, session creation
- [P1.3.4] Create auth routes: `POST /auth/magic-link`, `GET /auth/verify`, `POST /auth/logout`
- [P1.3.5] Implement auth middleware (`requireAuth`) per § 5.2 — session lookup, RLS context setting
- [P1.3.6] Add session cleanup job for expired sessions and magic links
- [P1.3.7] Write integration tests: full magic link flow, expired link rejection, session validation, logout

---

### [P1.4] Person Profile API

**Arch Ref:** § 8.2 (routes pattern)
**Depends On:** P1.3 (auth working)
**Effort:** 1 day
**Deliverable:** Authenticated user can read and update their profile.

Sub-tasks:

- [P1.4.1] Create `GET /api/me` route — return authenticated person's profile
- [P1.4.2] Create `PATCH /api/me` route — update display name, timezone, notification preferences, solo time constraints
- [P1.4.3] Create `DELETE /api/me` route — full account deletion per § 13.3
- [P1.4.4] Implement Zod validation schemas for all profile update fields
- [P1.4.5] Write integration tests: profile read, update, deletion cascade verification

---

### [P1.5] Google Calendar OAuth

**Arch Ref:** § 5.4 (Calendar OAuth Flow), § 6.1 (Provider Interface)
**Depends On:** P1.3 (auth), P1.2 (encryption)
**Effort:** 2 days
**Deliverable:** User can connect Google Calendar. OAuth tokens stored encrypted. Free/busy query works.

Sub-tasks:

- [P1.5.1] Register Google Cloud project, enable Calendar API, create OAuth credentials
- [P1.5.2] Implement `getGoogleAuthUrl()` per § 5.4 — OAuth URL generation with free/busy + events scopes
- [P1.5.3] Implement `handleGoogleCallback()` per § 5.4 — token exchange, encryption, storage
- [P1.5.4] Create routes: `GET /auth/calendar/google` (redirect to Google), `GET /auth/calendar/google/callback`
- [P1.5.5] Implement `CalendarProvider` interface per § 6.1
- [P1.5.6] Implement `GoogleCalendarProvider.getFreeBusy()` per § 6.2
- [P1.5.7] Implement `GoogleCalendarProvider.refreshToken()` per § 6.2
- [P1.5.8] Implement `GoogleCalendarProvider.createEvent()` and `deleteEvent()` per § 6.2 (needed later for write-back)
- [P1.5.9] Create `GET /api/me/calendars` route — list connected calendars with sync status
- [P1.5.10] Write integration tests with mocked Google API responses: OAuth flow, token refresh, free/busy query

---

### [P1.6] Basic Web Shell

**Arch Ref:** § 12.4 (PWA Configuration)
**Depends On:** P0.1
**Effort:** 0.5 days
**Deliverable:** React app with routing, auth context, and login screen.

Sub-tasks:

- [P1.6.1] Initialize Vite + React project in `apps/web` with Tailwind CSS 4
- [P1.6.2] Configure PWA plugin with manifest, icons, and service worker per § 12.4
- [P1.6.3] Set up React Router with routes: `/login`, `/`, `/partners`, `/pods`, `/settings`
- [P1.6.4] Create API client utility (`lib/api.ts`) with session token handling
- [P1.6.5] Create auth hook (`useAuth`) with magic link flow — email input, "check your email" state, session persistence
- [P1.6.6] Create minimal login page with magic link form
- [P1.6.7] Create app shell layout with bottom navigation (Calendar, Partners, Pods, Settings)

---

**Phase 1 Milestone:** A user can enter their email, receive a magic link, click it, land in the app, see their profile, and connect Google Calendar. The system can query their free/busy data.

---

## Phase 2: Relationship Graph

**Goal:** Users can create partnerships (with invite links), create pods, and set scheduling preferences.

**Duration:** 6 days

---

### [P2.1] Partner Invite & Accept Flow

**Arch Ref:** § 8.2 (Partner Management Routes)
**Depends On:** → P1.3 (auth), → P1.1 (schema)
**Effort:** 2 days
**Deliverable:** User A can generate an invite link, User B can accept it, creating a bidirectional partnership.

Sub-tasks:

- [P2.1.1] Create `partner_invites` table (if not in initial migration) with token, expiry, and acceptance tracking
- [P2.1.2] Implement `POST /api/partners/invite` — generate invite token, return sharable link per § 8.2
- [P2.1.3] Implement `POST /api/partners/accept/:token` — validate token, create partnership with canonical ordering, create default preferences per § 8.2
- [P2.1.4] Implement `GET /api/partners` — list partnerships with partner display info and own preferences per § 8.2
- [P2.1.5] Implement `PATCH /api/partners/:id/status` — pause or archive a partnership
- [P2.1.6] Add authorization check: only partnership members can view/modify
- [P2.1.7] Write integration tests: invite generation, acceptance, duplicate prevention, self-partnership rejection, expired token handling

---

### [P2.2] Partnership Preference Management

**Arch Ref:** § 8.2 (PATCH preferences), § 4.2 (partnership_preferences schema)
**Depends On:** → P2.1
**Effort:** 1.5 days
**Deliverable:** Each person can set needs and preferences for each partner relationship.

Sub-tasks:

- [P2.2.1] Implement `PATCH /api/partners/:id/preferences` with full Zod validation per § 8.2
- [P2.2.2] Implement `GET /api/partners/:id/preferences` — return own preferences for this partnership
- [P2.2.3] Handle the needs vs. preferences distinction: validate that `need_min_hours ≤ pref_ideal_hours`
- [P2.2.4] Implement recurring hold validation: no overlapping holds for the same person, valid time ranges
- [P2.2.5] Implement preferred window storage and validation
- [P2.2.6] Add custom event type preference support (`custom_event_prefs` JSONB)
- [P2.2.7] Write integration tests: preference CRUD, validation edge cases, authorization scoping

---

### [P2.3] Pod Management

**Arch Ref:** § 4.2 (pods, pod_members, pod_preferences schema)
**Depends On:** → P1.3 (auth), → P1.1 (schema)
**Effort:** 1.5 days
**Deliverable:** Users can create pods, invite members, and configure pod-level scheduling preferences.

Sub-tasks:

- [P2.3.1] Implement `POST /api/pods` — create pod, add creator as admin member
- [P2.3.2] Implement `POST /api/pods/:id/invite` — generate invite link scoped to pod
- [P2.3.3] Implement `POST /api/pods/:id/join/:token` — accept pod invitation, verify person exists
- [P2.3.4] Implement `GET /api/pods` — list my pods with member counts and scheduling info
- [P2.3.5] Implement `GET /api/pods/:id` — pod details with members (only accessible to pod members per § 4.3 RLS)
- [P2.3.6] Implement `PATCH /api/pods/:id` — update pod name, scheduling cadence, planning horizon, review window, cycle day/time
- [P2.3.7] Implement pod-access middleware per § 5.3
- [P2.3.8] Write integration tests: pod creation, invitation, join, cross-pod access denial

---

### [P2.4] Pod-Level Preferences

**Arch Ref:** § 4.2 (pod_preferences schema)
**Depends On:** → P2.3
**Effort:** 1 day
**Deliverable:** Pod admins can configure pod gathering frequency and sub-group configurations.

Sub-tasks:

- [P2.4.1] Implement `GET /api/pods/:id/preferences` — return pod scheduling preferences
- [P2.4.2] Implement `PATCH /api/pods/:id/preferences` — update full-pod gathering frequency/duration
- [P2.4.3] Implement sub-group configuration CRUD within pod preferences
- [P2.4.4] Validate sub-group member IDs are all actual pod members
- [P2.4.5] Validate sub-group preferred windows are valid time ranges
- [P2.4.6] Write integration tests: pod preference management, sub-group validation

---

**Phase 2 Milestone:** Two users can create accounts, form a partnership via invite link, set needs and preferences for each other, create a pod together, and configure pod-level scheduling preferences. All relationship data is properly scoped by authorization.

---

## Phase 3: Calendar Integration

**Goal:** The system can pull free/busy data from Google, iCloud, and Outlook, merge it across providers, and produce unified free windows for the optimizer.

**Duration:** 7 days

---

### [P3.1] Calendar Provider Abstraction

**Arch Ref:** § 6.1 (Provider Interface)
**Depends On:** → P1.5 (Google OAuth working)
**Effort:** 0.5 days
**Deliverable:** `CalendarProvider` interface defined and Google provider refactored to implement it.

Sub-tasks:

- [P3.1.1] Define `CalendarProvider` interface in `services/calendar/calendar.interface.ts` per § 6.1
- [P3.1.2] Refactor Google Calendar provider to implement the interface
- [P3.1.3] Create provider registry: `providers` map keyed by `calendar_provider` enum per § 6.3

---

### [P3.2] iCloud Calendar Integration

**Arch Ref:** § 6.1 (Provider Interface)
**Depends On:** → P3.1, → P1.2 (encryption)
**Effort:** 2 days
**Deliverable:** Users can connect iCloud Calendar. Free/busy queries work via CalDAV.

Sub-tasks:

- [P3.2.1] Research iCloud CalDAV authentication flow (Apple app-specific passwords or Sign in with Apple)
- [P3.2.2] Implement `ICloudCalendarProvider.getFreeBusy()` using CalDAV `VFREEBUSY` or event enumeration with `VEVENT` parsing
- [P3.2.3] Implement token/credential storage for iCloud (encrypted)
- [P3.2.4] Create OAuth/auth routes for iCloud: `GET /auth/calendar/icloud`, callback handler
- [P3.2.5] Implement `ICloudCalendarProvider.createEvent()` via CalDAV `PUT`
- [P3.2.6] Write integration tests with mocked CalDAV responses

---

### [P3.3] Microsoft Outlook Integration

**Arch Ref:** § 6.1 (Provider Interface)
**Depends On:** → P3.1, → P1.2 (encryption)
**Effort:** 2 days
**Deliverable:** Users can connect Outlook Calendar via Microsoft Graph. Free/busy queries work.

Sub-tasks:

- [P3.3.1] Register Azure AD application, configure Calendar.Read and Calendar.ReadWrite permissions
- [P3.3.2] Implement Microsoft OAuth flow using MS Graph auth endpoints
- [P3.3.3] Implement `OutlookCalendarProvider.getFreeBusy()` using MS Graph `/me/calendar/getSchedule` endpoint
- [P3.3.4] Implement `OutlookCalendarProvider.refreshToken()` using MS Graph token refresh
- [P3.3.5] Implement `OutlookCalendarProvider.createEvent()` using MS Graph `/me/calendar/events`
- [P3.3.6] Create routes: `GET /auth/calendar/outlook`, callback handler
- [P3.3.7] Write integration tests with mocked MS Graph responses

---

### [P3.4] Free/Busy Aggregator

**Arch Ref:** § 6.3 (Free/Busy Aggregator)
**Depends On:** → P3.1 (at minimum Google; ⇢ P3.2 and P3.3 can be added later)
**Effort:** 1.5 days
**Deliverable:** Given a person ID and time range, the system returns unified free windows merging all connected calendars and personal blocked time.

Sub-tasks:

- [P3.4.1] Implement `getPersonFreeWindows()` per § 6.3 — fetch from all providers, merge busy, invert to free
- [P3.4.2] Implement `mergeOverlappingWindows()` per § 6.3 — sort-and-merge algorithm
- [P3.4.3] Implement `invertToFreeWindows()` per § 6.3 — gaps between busy windows become free windows
- [P3.4.4] Implement `expandRecurringWindows()` per § 16.2 — expand person's blocked_windows into concrete busy windows within the horizon
- [P3.4.5] Add Redis caching with 1-hour TTL per § 6.3
- [P3.4.6] Handle provider errors gracefully — log error, continue with partial availability, update `sync_error` column
- [P3.4.7] Create `GET /api/me/availability?start=&end=` route — returns free windows for the authenticated user (useful for debugging)
- [P3.4.8] Write unit tests: overlapping window merging, free window inversion, recurring window expansion, cache hit/miss
- [P3.4.9] Write integration test: person with Google + Outlook calendars, verify merged result is correct

---

### [P3.5] Calendar Sync Health Monitoring

**Arch Ref:** § 4.2 (calendar_connections.sync_error)
**Depends On:** → P3.4
**Effort:** 1 day
**Deliverable:** Users can see which calendars are connected, when they last synced, and if there are errors.

Sub-tasks:

- [P3.5.1] Implement `GET /api/me/calendars` — list all connections with provider, last_synced_at, sync_error
- [P3.5.2] Implement `DELETE /api/me/calendars/:id` — disconnect a calendar, delete stored tokens
- [P3.5.3] Implement `POST /api/me/calendars/:id/refresh` — force re-sync of a specific calendar
- [P3.5.4] Add sync error notification: if a calendar fails to sync 3 times consecutively, notify the user

---

**Phase 3 Milestone:** A user with Google Calendar connected can see their free/busy windows for the next week. The aggregator correctly merges multiple calendars and personal blocked time. Calendar health is visible in the UI.

---

## Phase 4: Optimization Engine

**Goal:** The Python solver produces valid, fair schedules for all test fixture configurations.

**Duration:** 10 days

---

### [P4.1] Optimizer Data Models

**Arch Ref:** § 7.1 (API Contract)
**Depends On:** ⇢ P0.1 (shared types for alignment)
**Effort:** 1 day
**Deliverable:** Pydantic request/response models validated and documented.

Sub-tasks:

- [P4.1.1] Implement all Pydantic models per § 7.1: `PersonSpec`, `PartnerPreference`, `PodGatheringPref`, `SubgroupPref`, `LockedBlock`, `OptimizationRequest`
- [P4.1.2] Implement response models: `ProposedBlock`, `SatisfactionScore`, `OptimizationResponse`
- [P4.1.3] Add model validation: `need_min_hours ≤ pref_ideal_hours`, valid timezone strings, non-negative durations
- [P4.1.4] Write model serialization/deserialization tests with realistic sample data

---

### [P4.2] Candidate Slot Discovery

**Arch Ref:** § 7.3 (Candidate Slot Discovery)
**Depends On:** → P4.1
**Effort:** 2 days
**Deliverable:** Given people with free windows, the system finds all viable time slots for each pair/group.

Sub-tasks:

- [P4.2.1] Implement `CandidateSlot` dataclass per § 7.3
- [P4.2.2] Implement per-person free slot bitmask construction from free windows
- [P4.2.3] Implement locked block removal from free slot bitmasks
- [P4.2.4] Implement contiguous run detection (`_find_contiguous_runs`) per § 7.3
- [P4.2.5] Implement pair candidate generation: intersect two people's free slots, slide event-type-sized windows across shared runs per § 7.3
- [P4.2.6] Implement pod gathering candidate generation: intersect all pod members' free slots per § 7.3
- [P4.2.7] Implement sub-group candidate generation per § 7.3
- [P4.2.8] Write unit tests: two people with known free windows → verify correct candidate count and positions
- [P4.2.9] Write test: no overlapping free time → empty candidates returned
- [P4.2.10] Write test: locked blocks correctly excluded from candidates

---

### [P4.3] MILP Solver Core

**Arch Ref:** § 7.2 (Solver Implementation), § 16.1 (Maximin Fairness)
**Depends On:** → P4.2
**Effort:** 4 days
**Deliverable:** Solver takes candidates + preferences, returns proposed blocks with maximin fairness guarantee.

Sub-tasks:

- [P4.3.1] Install HiGHS Python bindings (`highspy`) and verify solver availability
- [P4.3.2] Implement solver scaffold: variable creation (binary x[i] for candidates, continuous z for min satisfaction) per § 7.2
- [P4.3.3] Implement Constraint 1: No person double-booked — for each (slot, person) pair, at most one candidate selected per § 7.2
- [P4.3.4] Implement Constraint 2: Hard minimums (needs) — sum of selected hours per pair ≥ need_min_hours per § 7.2
- [P4.3.5] Implement Constraint 3: Maximin fairness — z ≤ satisfaction_ratio for each person per § 7.2
- [P4.3.6] Implement Constraint 4: Solo/rest time — limit total scheduled evening slots per person per § 7.2
- [P4.3.7] Implement event-type-specific minimum constraints (e.g., minimum date nights)
- [P4.3.8] Implement objective function: maximize z (minimize negative z) per § 7.2
- [P4.3.9] Implement solution extraction: read binary variables, construct `ProposedBlock` list per § 7.2
- [P4.3.10] Implement infeasibility handling: detect when solver reports infeasible, generate human-readable explanations per § 7.2
- [P4.3.11] Add solver timeout (5 seconds max) with best-found solution returned on timeout
- [P4.3.12] Write test with `triad_basic` fixture: verify all three people get scheduled time, satisfaction scores reasonable
- [P4.3.13] Write test with `v_structure` fixture: verify A's time split between B and C, no cross-contamination
- [P4.3.14] Write test with `oversubscribed` fixture: verify maximin fairness — each partner gets roughly equal time, not winner-take-all

---

### [P4.4] Satisfaction Scoring & Gap Analysis

**Arch Ref:** § 7.2 (`_compute_satisfaction`), § 16.3 (Satisfaction Gap Analysis)
**Depends On:** → P4.3
**Effort:** 1.5 days
**Deliverable:** After solving, the system produces per-person satisfaction scores with per-partner breakdowns and actionable gap explanations.

Sub-tasks:

- [P4.4.1] Implement `_compute_satisfaction()` per § 7.2 — per-person, per-partner breakdown with need_met flags and pref_pct
- [P4.4.2] Implement `analyze_gaps()` per § 16.3 — detect oversubscription, insufficient shared free time, and generate human-readable insights
- [P4.4.3] Handle edge cases: person with no preferences set (100% satisfaction by default), person with 0 preferred hours
- [P4.4.4] Write tests: verify satisfaction scores match expected values for each test fixture
- [P4.4.5] Write test: gap analysis correctly identifies "your desired time exceeds your free time" scenario

---

### [P4.5] FastAPI Service & Integration

**Arch Ref:** § 7.4 (FastAPI Service)
**Depends On:** → P4.3, → P4.4
**Effort:** 1.5 days
**Deliverable:** Optimizer is a running HTTP service that accepts optimization requests and returns proposals.

Sub-tasks:

- [P4.5.1] Implement FastAPI application with `/optimize` endpoint per § 7.4
- [P4.5.2] Implement `/health` endpoint per § 7.4
- [P4.5.3] Add request validation and error handling with meaningful error messages
- [P4.5.4] Add request logging: solver time, variable count, feasibility status
- [P4.5.5] Write end-to-end HTTP test: POST a full optimization request, verify response structure and content
- [P4.5.6] Write performance test: verify solver completes within 2 seconds for 10-person, 7-day scenario
- [P4.5.7] Run all test fixtures (`triad_basic`, `v_structure`, `multi_pod_conflict`, `oversubscribed`, `timezone_mismatch`) through the HTTP API and verify results per § 15.2

---

**Phase 4 Milestone:** The optimizer service is running. Posting a JSON problem spec to `/optimize` returns a fair schedule. All five test fixtures produce valid results. Solver completes in under 2 seconds.

---

## Phase 5: Scheduling Cycle

**Goal:** End-to-end scheduling cycle from trigger through lock-in, with calendar write-back.

**Duration:** 8 days

---

### [P5.1] Cycle Manager: Collect & Optimize

**Arch Ref:** § 8.4 (Cycle Manager)
**Depends On:** → P3.4 (aggregator), → P4.5 (optimizer service), → P2.2 (preferences)
**Effort:** 3 days
**Deliverable:** Triggering a cycle collects free/busy for all involved people, posts to the optimizer, and stores proposed blocks.

Sub-tasks:

- [P5.1.1] Implement `CycleManager.triggerCycle()` per § 8.4 — determine horizon, find involved persons, create cycle record, enqueue job
- [P5.1.2] Implement `CycleManager.getInvolvedPersonIds()` — traverse relationship graph from the triggering person to find all connected people across partnerships and pods
- [P5.1.3] Implement `CycleManager.computeHorizon()` — determine start/end based on pod scheduling cadences and planning horizons
- [P5.1.4] Implement `CycleManager.processCycle()` per § 8.4:
  - [P5.1.4a] COLLECT phase: pull free/busy for each person via aggregator
  - [P5.1.4b] Build optimizer request: load preferences, pod gatherings, subgroups, event types, locked blocks
  - [P5.1.4c] OPTIMIZE phase: POST to optimizer service, handle response
  - [P5.1.4d] Store proposed time blocks in database with `status='proposed'`
  - [P5.1.4e] Store satisfaction report and infeasibility notes on cycle record
- [P5.1.5] Implement `loadPartnerPreferences()` — fetch all partnership preferences for involved persons, format for optimizer
- [P5.1.6] Implement `loadPodGatheringPrefs()` and `loadSubgroupPrefs()` — fetch pod-level preferences
- [P5.1.7] Implement `loadLockedBlocks()` — find existing locked time blocks within the horizon
- [P5.1.8] Write integration test: create two users with partnerships and preferences, trigger cycle, verify proposals stored

---

### [P5.2] BullMQ Job Infrastructure

**Arch Ref:** § 9.3 (Background Job Definitions)
**Depends On:** → P0.4 (Redis connected)
**Effort:** 1 day
**Deliverable:** Job queue processes optimizer cycles asynchronously with retries and monitoring.

Sub-tasks:

- [P5.2.1] Set up BullMQ queue and worker for `optimizer` jobs per § 9.3
- [P5.2.2] Set up BullMQ queue and worker for `cron` jobs per § 9.3
- [P5.2.3] Implement retry logic: 3 attempts with exponential backoff per § 8.4
- [P5.2.4] Implement failed job handling: update cycle status to `failed`, notify triggering user
- [P5.2.5] Add BullMQ dashboard (bull-board) on admin route for job monitoring
- [P5.2.6] Implement weekly cycle trigger cron: check which pods are due for a cycle, trigger for each per § 9.3

---

### [P5.3] Proposal API

**Arch Ref:** § 8.3 (Schedule Cycle Routes)
**Depends On:** → P5.1
**Effort:** 1.5 days
**Deliverable:** Users can view proposals, accept/decline individual blocks, and see satisfaction scores.

Sub-tasks:

- [P5.3.1] Implement `POST /api/schedule/run` — manual cycle trigger per § 8.3
- [P5.3.2] Implement `GET /api/schedule/proposals` — current proposals with participants, satisfaction scores, review window per § 8.3
- [P5.3.3] Implement `POST /api/schedule/proposals/:id/respond` — accept, decline, or request change per § 8.3
- [P5.3.4] Implement all-accepted detection: when all participants accept a block, update status to `accepted`
- [P5.3.5] Implement change request notification: when someone requests a change, notify other participants
- [P5.3.6] Implement `GET /api/schedule/current` — return all locked blocks for the current period
- [P5.3.7] Write integration tests: proposal viewing, acceptance flow, decline flow, change request flow

---

### [P5.4] Lock-In & Calendar Write-Back

**Arch Ref:** § 6.2 (createEvent), § 8.4 (auto-lock)
**Depends On:** → P5.3, → P1.5 (calendar create event)
**Effort:** 1.5 days
**Deliverable:** After review window or unanimous acceptance, proposals become locked events written to participants' calendars.

Sub-tasks:

- [P5.4.1] Implement `CycleManager.autoLockCycle()` — triggered by delayed job after review window expires per § 8.4
- [P5.4.2] Implement lock logic: accepted proposals → locked; pending proposals → locked (auto-accept on timeout); declined proposals → cancelled
- [P5.4.3] Implement calendar write-back: for each locked block, create event on each participant's connected calendar(s)
- [P5.4.4] Store calendar event IDs on the time block record (`calendar_event_ids` JSONB) for later deletion on reshuffle
- [P5.4.5] Handle write-back failures gracefully: log error, mark block as `locked` anyway, notify user that manual calendar entry may be needed
- [P5.4.6] Write integration test: full cycle from trigger through lock-in, verify calendar events created (with mocked calendar API)

---

### [P5.5] Reshuffle Flow

**Arch Ref:** § 8.3 (reshuffle), § 8.4 (cycle manager)
**Depends On:** → P5.4
**Effort:** 1 day
**Deliverable:** A user can request a reshuffle of a locked block. The system re-optimizes around other locked blocks and proposes swaps.

Sub-tasks:

- [P5.5.1] Implement `POST /api/schedule/reshuffle` — accepts block ID to reshuffle, reason, optional preferred alternative time
- [P5.5.2] Re-optimize: treat all OTHER locked blocks as immovable constraints, run optimizer for just the affected person's remaining preferences
- [P5.5.3] If the reshuffled block involves a partner, send swap proposal to partner for acceptance
- [P5.5.4] If accepted: delete old calendar events, create new ones, update block times and status
- [P5.5.5] If declined: notify requester, keep original schedule
- [P5.5.6] Write integration test: lock a schedule, request reshuffle on one block, verify other blocks unchanged and new proposal generated

---

**Phase 5 Milestone:** A complete scheduling cycle runs end-to-end: triggered manually or by cron, collects calendar data, runs the optimizer, presents proposals, accepts responses, locks in, and writes events to Google Calendar. Reshuffles work without disrupting other locked blocks.

---

## Phase 6: Frontend Core

**Goal:** A polished PWA with calendar view, partner/pod management, preference editing, and proposal review.

**Duration:** 12 days

---

### [P6.1] Design System & Component Library

**Arch Ref:** § 7 (Frontend Design Direction — from PRD), § 12.3 (SatisfactionRing)
**Depends On:** → P1.6 (web shell)
**Effort:** 2 days
**Deliverable:** Reusable component library with Pod Life's warm visual identity.

Sub-tasks:

- [P6.1.1] Define Tailwind theme: color palette (terracotta, sage, warm gold, dusty rose, stone neutrals) per PRD § 7.3
- [P6.1.2] Select and configure typography: Nunito or Quicksand for headings, system sans-serif for body
- [P6.1.3] Build `Button` component: primary (terracotta), secondary (sage), ghost, sizes, loading state
- [P6.1.4] Build `Card` component: rounded, subtle shadow, hover state
- [P6.1.5] Build `Modal` component: slide-up on mobile, centered on desktop, backdrop blur
- [P6.1.6] Build `SatisfactionRing` component per § 12.3 — SVG progress ring with animated fill
- [P6.1.7] Build `ProgressBar` component — horizontal bar variant for inline satisfaction display
- [P6.1.8] Build `Badge` component — status badges for time block states (proposed, accepted, locked)
- [P6.1.9] Build `Avatar` component — partner initials with assigned color background, optional image
- [P6.1.10] Build `EmptyState` component — friendly illustration + message for zero-data screens

---

### [P6.2] State Management & Data Fetching

**Arch Ref:** § 12.1 (State Management)
**Depends On:** → P6.1, → P5.3 (API endpoints exist)
**Effort:** 1.5 days
**Deliverable:** Zustand store and React Query hooks for all core data.

Sub-tasks:

- [P6.2.1] Set up Zustand store per § 12.1 — auth state, UI state, selected week
- [P6.2.2] Set up React Query (TanStack Query) for server state — partners, pods, proposals, schedule
- [P6.2.3] Create `usePartners()` hook — fetches and caches partner list
- [P6.2.4] Create `usePods()` hook — fetches and caches pod list with members
- [P6.2.5] Create `useSchedule(weekStart)` hook — fetches proposals and locked blocks for a given week
- [P6.2.6] Create `useSatisfaction()` hook — fetches current satisfaction scores
- [P6.2.7] Set up SSE connection for real-time updates per § 9.2 — invalidate relevant queries on events

---

### [P6.3] Calendar View

**Arch Ref:** § 12.2 (Calendar View Component)
**Depends On:** → P6.2, → P6.1
**Effort:** 3 days
**Deliverable:** Beautiful weekly and monthly calendar view with color-coded time blocks.

Sub-tasks:

- [P6.3.1] Build `WeekView` component per § 12.2 — 7-column grid with hour rows, week navigation
- [P6.3.2] Build `TimeBlock` component — positioned absolutely within day column, color-coded by partner, shows event type icon and partner name
- [P6.3.3] Implement block positioning: convert start/end times to pixel offsets within the day column
- [P6.3.4] Add status visual indicators: proposed (dashed border), accepted (solid border, slight opacity), locked (solid, full opacity)
- [P6.3.5] Build `MonthView` component — grid with day cells showing dot indicators for scheduled blocks
- [P6.3.6] Implement view toggle: week ↔ month with smooth transition
- [P6.3.7] Add "today" indicator: highlight current day, scroll to current time on load
- [P6.3.8] Build `TimeBlockDetail` modal — tap a block to see details, partner info, event type, respond to proposals
- [P6.3.9] Make mobile-responsive: single-day view on narrow screens with day swipe navigation
- [P6.3.10] Add glanceable satisfaction summary at top of calendar view (overall % with small progress ring)

---

### [P6.4] Partner Management UI

**Arch Ref:** PRD § 7.2 (Partners screen)
**Depends On:** → P6.2, → P6.1, → P2.1 (API)
**Effort:** 2 days
**Deliverable:** Partner list, invite flow, and per-partner preference editor.

Sub-tasks:

- [P6.4.1] Build `PartnerList` screen — cards for each partner with avatar, name, satisfaction ring, upcoming time
- [P6.4.2] Build `InvitePartner` flow — generate link, copy to clipboard, share sheet integration
- [P6.4.3] Build `AcceptInvite` page — accessible via invite link, shows inviter info, accept button
- [P6.4.4] Build `PreferenceEditor` component — form for needs (hard minimums) and preferences (soft targets) per-partner
- [P6.4.5] Build event type breakdown editor: sliders or number inputs for date nights, overnights, daytime hangs
- [P6.4.6] Build recurring hold editor: visual day/time picker for "Tuesdays are always for this partner"
- [P6.4.7] Build preferred window editor: visual time range selector for "I prefer evenings with this partner"
- [P6.4.8] Add color picker for partner color (used in calendar view)
- [P6.4.9] Add partner satisfaction detail view: per-event-type breakdown, trend over time (future: historical data)

---

### [P6.5] Pod Management UI

**Arch Ref:** PRD § 7.2 (Pods screen)
**Depends On:** → P6.2, → P6.1, → P2.3 (API)
**Effort:** 1.5 days
**Deliverable:** Pod list, creation, member management, and pod-level preference editing.

Sub-tasks:

- [P6.5.1] Build `PodList` screen — cards for each pod with emoji, name, member count, next scheduled gathering
- [P6.5.2] Build `CreatePod` flow — name, emoji picker, invite members
- [P6.5.3] Build `PodDetail` screen — member list with avatars, pod schedule, pod satisfaction
- [P6.5.4] Build `PodPreferenceEditor` — pod gathering frequency, duration, sub-group configuration
- [P6.5.5] Build `PodInvite` flow — generate and share pod-specific invite links

---

### [P6.6] Proposal Review UI

**Arch Ref:** PRD § 7.2 (Schedule Review screen)
**Depends On:** → P6.3, → P5.3 (API)
**Effort:** 2 days
**Deliverable:** When proposals arrive, the user sees a review screen with satisfaction scores and can accept/decline/negotiate.

Sub-tasks:

- [P6.6.1] Build `ProposalReview` screen — triggered when new proposals exist, shows full proposed week
- [P6.6.2] Build satisfaction summary header: overall %, per-partner breakdown with satisfaction rings
- [P6.6.3] Build gap callouts: "Could not schedule a pod gathering — no shared free time on weekends"
- [P6.6.4] Build per-block response UI: accept / decline / request change buttons on each proposed block
- [P6.6.5] Build change request flow: text input for change note, sent to other participant
- [P6.6.6] Build "Accept All" button for quick approval
- [P6.6.7] Show review window countdown timer: "Proposals lock in 36 hours"
- [P6.6.8] Build notification badge on calendar tab when proposals are pending review
- [P6.6.9] Build reshuffle request UI: select a locked block, describe the conflict, submit reshuffle request

---

**Phase 6 Milestone:** The PWA is fully functional. Users can log in, manage partners and pods, set preferences, view their calendar, review proposals, and respond. The app feels warm and personal, not clinical.

---

## Phase 7: Telegram Integration

**Goal:** Telegram bot sends proposals, accepts responses, and posts to pod group chats.

**Duration:** 5 days

---

### [P7.1] Bot Setup & Account Linking

**Arch Ref:** § 10.1 (Bot Setup)
**Depends On:** → P1.3 (auth), → P1.4 (person profile)
**Effort:** 1.5 days
**Deliverable:** Telegram bot is running. Users can link their Telegram account via deep link from the app.

Sub-tasks:

- [P7.1.1] Create Telegram bot via BotFather, configure commands list
- [P7.1.2] Set up grammy bot instance with webhook handler per § 10.1
- [P7.1.3] Implement `/start` command with deep link token handling per § 10.1
- [P7.1.4] Implement Telegram account linking: generate link token in app → user clicks → bot receives → links `telegram_chat_id` to person record
- [P7.1.5] Create settings UI in PWA for Telegram connection: generate link, show connection status
- [P7.1.6] Implement `/schedule` command per § 10.1 — formatted upcoming week
- [P7.1.7] Implement `/status` command per § 10.1 — satisfaction scores with progress bars

---

### [P7.2] Proposal Notifications via Telegram

**Arch Ref:** § 10.2 (Proposal Notification Flow)
**Depends On:** → P7.1, → P5.3 (proposals exist)
**Effort:** 1.5 days
**Deliverable:** When a cycle completes, each person with Telegram linked gets a DM with their proposal summary and inline accept/decline buttons.

Sub-tasks:

- [P7.2.1] Implement `sendProposalNotifications()` per § 10.2 — iterate persons, build personalized DM with proposed blocks and satisfaction scores
- [P7.2.2] Build inline keyboard with Accept All / Open App buttons per § 10.2
- [P7.2.3] Implement callback query handler for `proposal:accept` per § 10.1
- [P7.2.4] Implement callback query handler for `proposal:decline`
- [P7.2.5] Implement callback query handler for `proposal:change` — set state to await next message as change note per § 10.1
- [P7.2.6] Hook into notification service: when cycle status → `proposed`, trigger Telegram notifications
- [P7.2.7] Write integration test: create proposals, verify bot sends correct DMs (with mocked Telegram API)

---

### [P7.3] Pod Group Chat Integration

**Arch Ref:** § 10.1 (notifyPodGroup)
**Depends On:** → P7.1, → P2.3 (pods)
**Effort:** 1 day
**Deliverable:** Pod group chats receive schedule summaries. Messages are strictly scoped to pod context.

Sub-tasks:

- [P7.3.1] Implement pod group chat linking: pod admin adds bot to Telegram group, bot stores `telegram_group_chat_id`
- [P7.3.2] Implement `notifyPodGroup()` per § 10.1 — post schedule summary to pod group
- [P7.3.3] Privacy enforcement: verify that all information in group messages only references members of that pod — no partner names or pod names from other contexts
- [P7.3.4] Post locked schedule summary to pod group when cycle locks
- [P7.3.5] Post reshuffle notifications to pod group when a pod member reshuffles

---

### [P7.4] Telegram Privacy Guardrails

**Arch Ref:** § 10.1 (privacy scoping)
**Depends On:** → P7.2, → P7.3
**Effort:** 1 day
**Deliverable:** All Telegram messages pass privacy audit — no cross-pod leakage possible.

Sub-tasks:

- [P7.4.1] Create `TelegramPrivacyFilter` — validates that any message to a pod group only contains member names/info from that pod
- [P7.4.2] Create `TelegramDMPrivacyFilter` — validates that DM messages don't expose pod-internal details to non-members
- [P7.4.3] Write comprehensive tests: simulate V-structure where bot sends messages to both pods, verify no cross-contamination
- [P7.4.4] Add audit logging for all Telegram messages sent per § 4.2 (audit_log)

---

**Phase 7 Milestone:** Telegram bot sends personalized proposal DMs with inline response buttons. Pod group chats receive schedule summaries. No cross-pod information leakage in any Telegram message.

---

## Phase 8: AI Layer

**Goal:** Natural language preference setting, schedule explanation, and reshuffle negotiation.

**Duration:** 5 days

---

### [P8.1] LLM Service Foundation

**Arch Ref:** § 11.1 (LLM Service)
**Depends On:** ⇢ P2.2 (preferences API), ⇢ P5.3 (schedule API)
**Effort:** 1 day
**Deliverable:** Claude API integration with system prompt, structured output parsing, and error handling.

Sub-tasks:

- [P8.1.1] Install Anthropic SDK, configure API key from environment
- [P8.1.2] Implement `LLMService` class with system prompt per § 11.1
- [P8.1.3] Implement response parsing: extract JSON from Claude responses, handle markdown fences
- [P8.1.4] Implement error handling: API errors, malformed responses, timeout handling
- [P8.1.5] Add LLM call logging for debugging and cost monitoring
- [P8.1.6] Implement graceful degradation: if LLM is unavailable, all features fall back to manual input

---

### [P8.2] Natural Language Preference Parsing

**Arch Ref:** § 11.1 (parsePreferences)
**Depends On:** → P8.1, → P2.2 (preferences)
**Effort:** 1.5 days
**Deliverable:** Users can type natural language to set preferences; system converts to structured data.

Sub-tasks:

- [P8.2.1] Implement `LLMService.parsePreferences()` per § 11.1 — partner context injection, structured JSON output
- [P8.2.2] Create `POST /api/partners/:id/preferences/natural` route — accepts natural language, returns parsed preferences for confirmation
- [P8.2.3] Build confirmation UI in frontend: show parsed preferences, user confirms or adjusts before saving
- [P8.2.4] Integrate into Telegram bot: implement conversational preference setting in DM ("How much time do you want with Alex this week?")
- [P8.2.5] Write tests with sample inputs: "I want to see Alex twice a week, mostly evenings" → verify correct structured output
- [P8.2.6] Handle ambiguous inputs: "more time with everyone" → ask clarifying questions

---

### [P8.3] Schedule Explanation

**Arch Ref:** § 11.1 (explainSchedule)
**Depends On:** → P8.1, → P5.3 (schedule data)
**Effort:** 1 day
**Deliverable:** Users can ask "Why didn't I get an overnight with Alex?" and get a clear, empathetic explanation.

Sub-tasks:

- [P8.3.1] Implement `LLMService.explainSchedule()` per § 11.1 — inject preferences, satisfaction scores, proposed blocks, infeasibility notes
- [P8.3.2] Create `POST /api/schedule/explain` route — accepts question, returns explanation
- [P8.3.3] Integrate into Telegram bot: handle natural language schedule questions in DM
- [P8.3.4] Add "Why?" button on satisfaction displays in frontend — triggers explanation modal
- [P8.3.5] Write tests: verify explanation references correct constraints and offers constructive suggestions

---

### [P8.4] Natural Language Reshuffle

**Arch Ref:** § 11.1 (parseReshuffleRequest)
**Depends On:** → P8.1, → P5.5 (reshuffle API)
**Effort:** 1.5 days
**Deliverable:** Users can describe scheduling conflicts in natural language, system identifies affected blocks and triggers reshuffle.

Sub-tasks:

- [P8.4.1] Implement `LLMService.parseReshuffleRequest()` per § 11.1 — parse intent, identify affected block, extract constraints
- [P8.4.2] Create `POST /api/schedule/reshuffle/natural` route — accepts natural language, returns parsed intent for confirmation
- [P8.4.3] Build confirmation UI: show what will be reshuffled, get approval before executing
- [P8.4.4] Integrate into Telegram bot: "Something came up Thursday, can we move things around?" → parse → confirm → reshuffle
- [P8.4.5] Write tests with sample inputs: verify correct block identification and constraint extraction

---

**Phase 8 Milestone:** Users can set preferences, ask schedule questions, and request reshuffles in natural language — via both the PWA and Telegram. All AI features degrade gracefully when the LLM is unavailable.

---

## Phase 9: Privacy Hardening

**Goal:** Comprehensive privacy audit. All boundary tests pass. Timing inference mitigations in place.

**Duration:** 4 days

---

### [P9.1] Privacy Boundary Test Suite

**Arch Ref:** § 15.3 (Privacy Boundary Tests)
**Depends On:** → All P5 tasks (scheduling working), → P7.4 (Telegram privacy)
**Effort:** 2 days
**Deliverable:** Comprehensive automated test suite that verifies no information leaks across pod boundaries.

Sub-tasks:

- [P9.1.1] Implement `test_partner_invisible_across_pods` per § 15.3 — V-structure, verify B cannot see C
- [P9.1.2] Implement `test_schedule_opacity` per § 15.3 — verify busy time from other pods shows as "unavailable" not as specific event
- [P9.1.3] Test: person queries `/api/pods/:id` for a pod they're not in → 403
- [P9.1.4] Test: person queries `/api/partners` → only sees own partnerships, not others'
- [P9.1.5] Test: person queries `/api/schedule/proposals` → only sees blocks they participate in
- [P9.1.6] Test: after account deletion, partner sees "Deleted User" with no personal data
- [P9.1.7] Test: Telegram bot DM for person A never mentions person C (who is in a different pod)
- [P9.1.8] Test: Pod group chat messages only contain names of pod members
- [P9.1.9] Test: satisfaction report for person A doesn't expose partner-specific data to other pod members
- [P9.1.10] Test: API responses pass through privacy scrub middleware per § 13.2 — no `telegramChatId`, `externalPodIds`, or `otherPersonPreferences` leak

---

### [P9.2] Privacy Scrub Middleware

**Arch Ref:** § 13.2 (Privacy Middleware)
**Depends On:** → P0.4
**Effort:** 0.5 days
**Deliverable:** All API responses are scrubbed of cross-context information.

Sub-tasks:

- [P9.2.1] Implement `privacyScrub` middleware per § 13.2
- [P9.2.2] Apply to all `/api/*` routes
- [P9.2.3] Verify scrubbing doesn't break normal responses (test with full data payloads)

---

### [P9.3] Timing Inference Mitigation

**Arch Ref:** § 4.3 (Threat Model — timing inference attack)
**Depends On:** → P5.4 (locked schedule)
**Effort:** 0.5 days
**Deliverable:** Optional "privacy mode" that adds jitter to scheduling patterns.

Sub-tasks:

- [P9.3.1] Add `privacy_mode` flag to person preferences: when enabled, solver adds ±30min jitter to proposed block times
- [P9.3.2] When privacy mode is on, vary scheduling patterns week-to-week (don't always schedule Partner B on Tuesdays)
- [P9.3.3] Document the timing inference risk and mitigation in user-facing help docs

---

### [P9.4] Data Lifecycle Audit

**Arch Ref:** § 13.3 (Data Retention and Deletion)
**Depends On:** → P1.4 (account deletion API)
**Effort:** 1 day
**Deliverable:** Verified: account deletion removes all data. Calendar tokens are truly ephemeral. Audit log is comprehensive.

Sub-tasks:

- [P9.4.1] Review and test `deleteAccount()` per § 13.3 — verify all tables cleaned up, Redis keys removed
- [P9.4.2] Verify calendar free/busy data is only stored in Redis with TTL, never in PostgreSQL
- [P9.4.3] Verify calendar OAuth tokens are encrypted at rest per § 13.1
- [P9.4.4] Verify audit log captures all sensitive operations: login, preference changes, proposal responses, reshuffles, account deletion
- [P9.4.5] Add data export endpoint: `GET /api/me/export` — GDPR-style data export of all person data
- [P9.4.6] Write documentation: data retention policy, encryption methods, deletion scope

---

**Phase 9 Milestone:** All 10+ privacy boundary tests pass. Privacy scrub middleware is active. Timing inference mitigation is available. Account deletion is verified complete. Data retention policy is documented.

---

## Phase 10: Polish & Launch Preparation

**Goal:** Production-ready open source release with self-hosting docs, reference deployment, and landing page.

**Duration:** 8 days

---

### [P10.1] UI Polish

**Arch Ref:** PRD § 7 (Frontend Design Direction)
**Depends On:** → P6 (all frontend tasks)
**Effort:** 2 days
**Deliverable:** Smooth animations, delightful micro-interactions, cohesive visual feel.

Sub-tasks:

- [P10.1.1] Add page transition animations (Framer Motion or View Transitions API)
- [P10.1.2] Add time block drag interactions: long-press a proposed block to see alternatives
- [P10.1.3] Add satisfaction ring animation: fill smoothly on load
- [P10.1.4] Add proposal notification toast with slide-in animation
- [P10.1.5] Polish empty states: friendly illustrations for "No partners yet," "No proposals," etc.
- [P10.1.6] Add haptic feedback on mobile for accept/decline actions (Vibration API)
- [P10.1.7] Review and refine color usage: ensure partner colors have sufficient contrast, dark mode prep

---

### [P10.2] Accessibility Audit

**Arch Ref:** PRD § 6 (Phase 6 — Accessibility audit)
**Depends On:** → P10.1
**Effort:** 1 day
**Deliverable:** WCAG 2.1 AA compliance.

Sub-tasks:

- [P10.2.1] Run automated accessibility scan (axe-core) on all screens
- [P10.2.2] Fix all critical and serious violations
- [P10.2.3] Verify keyboard navigation for all interactive elements
- [P10.2.4] Verify screen reader compatibility for calendar view and satisfaction indicators
- [P10.2.5] Ensure color contrast meets 4.5:1 minimum for all text
- [P10.2.6] Add ARIA labels for icon-only buttons and status indicators

---

### [P10.3] Self-Hosting Documentation

**Arch Ref:** § 14 (Infrastructure & Deployment)
**Depends On:** → P0.2 (Docker Compose)
**Effort:** 1.5 days
**Deliverable:** A non-developer can self-host Pod Life with Docker Compose by following the guide.

Sub-tasks:

- [P10.3.1] Write `SELF_HOSTING.md` with step-by-step instructions: prerequisites, clone, configure `.env`, `docker-compose up`
- [P10.3.2] Document required external accounts: Google Cloud project (for Calendar API), Telegram bot token, SMTP service
- [P10.3.3] Document optional accounts: Anthropic API key (for AI features), Microsoft Azure AD (for Outlook)
- [P10.3.4] Write backup and restore guide for PostgreSQL data
- [P10.3.5] Write upgrade guide: pull latest images, run migrations, restart
- [P10.3.6] Test self-hosting guide on a fresh VPS (DigitalOcean or Hetzner) — verify end-to-end

---

### [P10.4] Reference Deployment

**Arch Ref:** § 14 (Infrastructure), § 2.2 (System Requirements)
**Depends On:** → P10.3
**Effort:** 1.5 days
**Deliverable:** Pod Life is running on a managed platform, accessible at a public URL.

Sub-tasks:

- [P10.4.1] Choose deployment platform: Railway, Fly.io, or Render
- [P10.4.2] Set up managed PostgreSQL (Neon or Supabase free tier)
- [P10.4.3] Set up managed Redis (Upstash free tier)
- [P10.4.4] Deploy API, optimizer, and web services with environment variables
- [P10.4.5] Configure custom domain and TLS
- [P10.4.6] Set up health monitoring and alerting (UptimeRobot or similar)
- [P10.4.7] Configure automatic deployments from main branch

---

### [P10.5] Open Source Repository

**Arch Ref:** PRD § 1 (Open Source Strategy)
**Depends On:** → P10.3
**Effort:** 1 day
**Deliverable:** Public GitHub repo with clean README, contributing guide, and license.

Sub-tasks:

- [P10.5.1] Choose license (recommendation: AGPL-3.0 — ensures self-hosted modifications stay open, aligns with commons values)
- [P10.5.2] Write comprehensive `README.md`: product description, screenshots/GIFs, quick start, architecture overview, contributing
- [P10.5.3] Write `CONTRIBUTING.md`: development setup, code style, PR process, issue templates
- [P10.5.4] Write `SECURITY.md`: responsible disclosure process, security contact
- [P10.5.5] Create issue templates: bug report, feature request, privacy concern
- [P10.5.6] Clean up git history: ensure no secrets, API keys, or personal data in commit history
- [P10.5.7] Add badges: CI status, license, version

---

### [P10.6] Landing Page

**Depends On:** → P10.4 (reference deployment URL known)
**Effort:** 1 day
**Deliverable:** Simple, warm landing page explaining Pod Life and linking to the app and GitHub.

Sub-tasks:

- [P10.6.1] Design and build single-page landing: hero, problem statement, how it works (3 steps), open source callout, CTA
- [P10.6.2] Include screenshots or GIF walkthrough of the scheduling flow
- [P10.6.3] Link to: app URL, GitHub repo, self-hosting docs
- [P10.6.4] Deploy as static site (can be part of the web app build or separate)

---

**Phase 10 Milestone:** Pod Life is live at a public URL. The GitHub repo is public with comprehensive documentation. A landing page explains the product. Benjamin's pod is using it in production.

---

## Dependency Graph (Critical Path)

The critical path through the project — the longest chain of hard dependencies — determines the minimum calendar time.

```
P0.1 → P0.2 → P0.4 → P1.1 → P1.3 → P2.1 → P2.2 ─┐
                                                      │
P0.1 ──────────────────→ P1.5 → P3.1 → P3.4 ─────────┤
                                                      │
                    P0.1 → P4.1 → P4.2 → P4.3 → P4.5 ┤
                                                      │
                                         ┌────────────┘
                                         ▼
                                       P5.1 → P5.3 → P5.4 → P5.5
                                                │
                                                ▼
                                P1.6 → P6.1 → P6.2 → P6.3 → P6.6
                                                              │
                                                              ▼
                                              P7.1 → P7.2 → P7.4
                                                              │
                                                              ▼
                                              P8.1 → P8.2 → P8.4
                                                              │
                                                              ▼
                                                     P9.1 → P9.4
                                                              │
                                                              ▼
                                               P10.1 → P10.4 → P10.5
```

**Key parallelization opportunities:**

- **P4 (optimizer) and P2+P3 (relationship graph + calendar)** can be built in parallel. The optimizer only needs its own data models (P4.1), not the API endpoints. They converge at P5.1.
- **P6 (frontend)** can start as soon as API endpoints are stubbed, even before P5 is complete. Use mock data initially.
- **P7 (Telegram) and P8 (AI)** can be built in parallel with each other after P5.
- **P1.6 (web shell)** can start immediately alongside P1.1–P1.5.

---

## Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| iCloud CalDAV auth is complex and poorly documented | Delays P3.2 by 2–4 days | High | Start P3.2 research early. Fall back to manual availability entry if iCloud integration is too brittle. Ship without iCloud in v1 if necessary. |
| HiGHS Python bindings don't install cleanly in Docker | Blocks P4.3 | Medium | Test Docker build early in P0.2. Have OR-Tools as fallback solver. Pre-build wheels. |
| Google Calendar API rate limits during development | Slows P3.4 testing | Medium | Use mocked API responses for most tests. Only test against real API in E2E suite. |
| Maximin fairness solver is too slow for complex polycules (10+ people) | Performance issue at launch | Low | At 10 people / 7-day horizon, HiGHS should solve in <2s. Add solver timeout (P4.3.11) as safety valve. For extreme cases, fall back to greedy heuristic. |
| Users find preference setting too complex | Adoption friction | Medium | AI preference parsing (P8.2) significantly reduces friction. Sensible defaults in P2.1.3. Progressive disclosure — show simple mode first, advanced settings on demand. |
| Privacy boundary test reveals a leakage path | Security issue | Medium | Run privacy tests continuously in CI (P9.1). RLS policies (P1.1.12) are the defense-in-depth backstop. |

---

## Post-Launch Backlog (Future Phases)

These items are explicitly deferred from v1 but documented for planning.

| ID | Feature | Estimated Effort | Dependencies |
|----|---------|-----------------|--------------|
| F1 | Relationship check-in prompts (periodic reflection) | 5 days | P5, P7 |
| F2 | Historical satisfaction trends (charts over time) | 3 days | P5, P6 |
| F3 | Shared expenses / date planning integration | 8 days | P2, P6 |
| F4 | Native iOS/Android app (React Native) | 20 days | P6 (share components) |
| F5 | Monogamous "lite mode" fork | 5 days | P2, P6 (feature flags) |
| F6 | Conflict early warning ("your needs exceed your free time") | 3 days | P4, P6 |
| F7 | ICS calendar feed export per pod | 2 days | P5 |
| F8 | NFC/proximity spontaneous meetup suggestions | 8 days | P2, P6, native app |
| F9 | Onboarding wizard with guided preference discovery | 4 days | P8.2, P6 |
| F10 | Multi-language support (i18n) | 5 days | P6 |

---

*Pod Life is a project by Benjamin Life (@omniharmonic). Built with love, for love.*
