# CLAUDE.md — Pod Life

## What You're Building

Pod Life is a scheduling and relationship-time management tool for polyamorous families. Users create partnerships (bidirectional romantic relationships) and pods (named groups of people in some relationship configuration), set preferences for how much quality time they want with each partner, connect their calendars, and the system proposes fair schedules that maximize everyone's satisfaction.

The core innovation is a **maximin fairness optimizer** — a constraint solver that doesn't just find *a* schedule but finds the *fairest* schedule, where "fair" means maximizing the satisfaction of the least-satisfied person across all relationships.

This is an open-source project by Benjamin Life (@omniharmonic). It is not affiliated with OpenCivics or OpenCivics Labs. All commits, documentation, and public-facing materials should attribute to Benjamin Life.

---

## Project Documents

You have three reference documents. Read all three before writing any code. They are the source of truth, in this priority order:

1. **Implementation Plan** (`pod-life-implementation-plan.md`) — Your task list. Every task has an ID (P0.1, P1.3, etc.), dependencies, architecture cross-references, and a concrete deliverable. Follow this document's sequence unless you have a specific reason to deviate.

2. **Technical Architecture** (`pod-life-technical-architecture.md`) — The detailed technical spec. Contains complete database schema, code samples for every major component, API contracts, and the full MILP solver implementation. When the implementation plan says "Arch Ref: § 7.2", that means section 7.2 of this document.

3. **PRD** (`pod-life-prd.md`) — Product requirements, user flows, and design direction. Consult this for product-level questions (what should the UX feel like, what are the event types, what's the scheduling cycle flow).

When these documents conflict, the implementation plan takes precedence for sequencing, the technical architecture for technical decisions, and the PRD for product intent.

---

## Architecture at a Glance

```
Monorepo (Turborepo)
├── apps/api          → Hono (Node.js) — REST API, auth, business logic
├── apps/web          → React + Vite — PWA frontend
├── apps/optimizer    → Python + FastAPI — MILP scheduling solver
└── packages/shared   → TypeScript types and Zod schemas
```

**Data stores:** PostgreSQL 16 (primary), Redis 7 (sessions, cache, job queue).

**External services:** Google Calendar API, Microsoft Graph API, Apple CalDAV (iCloud), Telegram Bot API, Anthropic Claude API.

**Key principle:** The optimizer is a stateless microservice. It receives a problem spec via HTTP POST and returns a proposed schedule. It has no database access. All state management happens in the API server.

### Two Deployment Targets, One Codebase

The API uses **dual-driver adapters** so the same code runs against either stack:

| Layer       | Self-hosted (Docker / VPS)              | Serverless (reference)                      |
|-------------|-----------------------------------------|---------------------------------------------|
| Compute     | `apps/api/src/index.ts` long-running    | `apps/api/api/index.ts` Vercel Function     |
| Database    | postgres-js + local Postgres            | `@neondatabase/serverless` Pool + Neon WS   |
| Redis       | ioredis + local Redis                   | `@upstash/redis` REST                       |
| Job queue   | BullMQ workers in-process               | QStash → `/internal/<job>` webhooks         |
| Cron        | BullMQ delayed jobs                     | Vercel Cron → `/api/cron/<job>`             |
| Email       | nodemailer SMTP                         | Resend                                      |
| Optimizer   | Inline WASM HiGHS in `apps/api/src/services/optimizer/` (default) — Python container at `apps/optimizer/` is the legacy reference implementation, opt-in via `OPTIMIZER_HTTP=1` |

The driver is auto-selected by env: `*.neon.tech` in `DATABASE_URL` selects Neon, `UPSTASH_REDIS_REST_URL` selects Upstash, `QSTASH_TOKEN` selects QStash, `RESEND_API_KEY` selects Resend. Tests run against the self-hosted path.

---

## Development Environment

```bash
# Prerequisites: Node.js 22+, Python 3.12+, Docker, pnpm

# Clone and install
git clone <repo>
cd pod-life
pnpm install
cd apps/optimizer && pip install -r requirements.txt && cd ../..

# Start infrastructure
docker-compose up -d postgres redis

# Run API
cd apps/api && pnpm dev

# Run optimizer
cd apps/optimizer && uvicorn src.main:app --reload --port 8000

# Run frontend
cd apps/web && pnpm dev
```

Full stack via Docker: `docker-compose up` starts everything.

---

## What to Build First, Second, Third

### The Three Parallel Tracks

The project has three independent tracks that converge at Phase 5. This is the single most important thing to understand about the build sequence:

```
TRACK A: Auth + Data Model + Relationships
  P0.1 → P0.4 → P1.1 → P1.3 → P1.4 → P2.1 → P2.2 → P2.3 → P2.4

TRACK B: Calendar Integration
  P1.5 → P3.1 → P3.2 → P3.3 → P3.4 → P3.5

TRACK C: Optimization Engine
  P4.1 → P4.2 → P4.3 → P4.4 → P4.5

         ╰──── All three converge here ────╮
                                           ▼
CONVERGENCE: Scheduling Cycle
  P5.1 → P5.2 → P5.3 → P5.4 → P5.5

Then sequential:
  P6 (Frontend) → P7 (Telegram) ─┐
                  P8 (AI Layer) ──┤→ P9 (Privacy) → P10 (Launch)
```

**If you are the sole developer**, alternate between tracks. Build P0 and P1, then jump to P4 (optimizer) while the auth/data model settles, then come back for P2 and P3. The optimizer is the most intellectually satisfying piece and can be validated entirely in isolation.

**If you can parallelize**, the optimal split is: one person on Track A+B (API/calendar), one person on Track C (optimizer), converge at P5. Frontend (P6) is also highly parallelizable — it can start with mock data as soon as the API contracts are defined.

---

## What Needs Careful Attention

### 1. The Privacy Model (CRITICAL)

This is the most important thing to get right. Pod Life handles information about people's intimate relationships. A privacy leak isn't a bug — it's a betrayal of trust that could damage real relationships.

**The core invariant:** A person can only see data scoped to pods they belong to. If Person A is in Pod 1 (with B) and Pod 2 (with C), then B must never see any evidence that C exists, and vice versa. This applies to:

- API responses (partnerships, schedules, satisfaction scores)
- Telegram messages (both DMs and group chats)
- Calendar events written back (event titles must not reveal other partners)
- Error messages (must not leak partner names or pod names from other contexts)
- Timing patterns (addressed by optional privacy mode with scheduling jitter)

**Defense in depth:**

- **Layer 1:** Application logic scopes all queries to the authenticated person's pods/partnerships.
- **Layer 2:** PostgreSQL Row-Level Security policies enforce access at the database level, so even if application logic has a bug, data can't leak. See § 4.3 of the architecture doc.
- **Layer 3:** Privacy scrub middleware (§ 13.2) strips sensitive fields from all API responses before they leave the server.
- **Layer 4:** Telegram privacy filters (P7.4) validate every outbound message against pod membership.

**When building any feature that touches relationship or schedule data, always ask:** "If Person B called this endpoint/saw this message/received this notification, would they learn anything about Person C who is in a different pod?" If the answer is anything other than a definitive no, there's a privacy bug.

The privacy boundary test suite (P9.1) is not optional. It is among the most important code in the project. Write these tests early and run them in CI.

### 2. The Optimizer Formulation (HIGH COMPLEXITY)

The MILP solver in § 7.2 is the most algorithmically complex code in the project. The implementation plan breaks it into careful sub-tasks (P4.3.1 through P4.3.14), and you should follow that sequence precisely.

Key things that are easy to get wrong:

- **Candidate slot explosion.** For a 7-day horizon with 30-minute slots (336 slots), 5 people, and 4 event types, you can generate tens of thousands of candidate slots. This is fine for the solver (HiGHS handles it), but the candidate discovery code (P4.2) must be efficient. Use bitmask intersection, not nested loops over individual slots.

- **Constraint 3 (maximin fairness)** is the most subtle. The constraint is: `sum_of_hours_for_person_p - total_pref_hours_for_p * z >= 0`. If you get the sign wrong or forget to handle people with zero preferred hours, the solver will produce nonsensical results. Test this constraint in isolation before combining with others.

- **Infeasibility** is not an error — it's a normal outcome. When someone's needs can't be met (e.g., two partners each need 10 hours but only share 6 hours of free time), the solver should report this clearly, not crash. The infeasibility handling in P4.3.10 is critical for user trust.

- **The test fixtures** (§ 15.2) are your validation suite. Every fixture tests a different topological challenge. Don't skip any of them. The `multi_pod_conflict` and `oversubscribed` fixtures are the ones most likely to reveal formulation bugs.

### 3. Calendar OAuth Token Management (SECURITY SENSITIVE)

Calendar OAuth tokens grant access to people's personal schedules. They must be:

- **Encrypted at rest** using AES-256-GCM (§ 13.1). Never store plaintext tokens.
- **Refreshed proactively.** Check `token_expires_at` before every API call. If expired, refresh and update the encrypted stored token.
- **Scoped minimally.** Request only `calendar.freebusy` and `calendar.events` scopes, not full calendar read access.
- **Deleted completely** on account deletion (§ 13.3) and calendar disconnection.

The encryption key (`ENCRYPTION_KEY` in env) must be a 32-byte hex string generated with `openssl rand -hex 32`. If this key is lost, all stored tokens become unrecoverable and every user must re-authenticate their calendars.

### 4. iCloud CalDAV Integration (HIGH RISK)

Apple's CalDAV implementation is the most fragile integration in the project. Their documentation is sparse, their authentication model for third-party apps is restrictive (app-specific passwords, not OAuth), and their CalDAV server has quirks that differ from the RFC spec.

**Recommendation:** Start researching P3.2 early but don't block the rest of the project on it. The architecture is designed so that any calendar provider is optional — the system works with just Google Calendar. Ship v1 with Google and Outlook support. Add iCloud when it's solid, or provide manual availability entry as a fallback for iCloud users.

### 5. Telegram Message Content (PRIVACY SENSITIVE)

Every Telegram message the bot sends must be reviewed for privacy leakage. The two distinct message contexts:

- **Pod group chat:** May only reference people who are members of that pod. Never mention other pods, partnerships, or people outside the pod.
- **Individual DM:** May reference the person's own partnerships and satisfaction scores, but must not reveal which specific partner is causing a particular time slot to be "unavailable."

Build the privacy filters (P7.4) before building the notification flows (P7.2, P7.3), not after.

---

## What Can Be Optimized

### 1. Skip iCloud in v1

As noted above, iCloud integration (P3.2) is 2 days of estimated effort with high risk of ballooning. Defer it. Google + Outlook covers the vast majority of users. Save 2-4 days.

### 2. Start Frontend with Mock Data

The frontend (P6) can begin development as soon as the API contracts are defined (after P0.4), using mock data. You don't need working API endpoints to build the calendar view, preference editor, or proposal review UI. Wire up real API calls later. This lets frontend work happen in parallel with Tracks A/B/C.

### 3. Simplify the Preference Editor Initially

The full preference editor (P6.4.4–P6.4.7) is complex: recurring holds, preferred windows, custom event types. For v1, ship a simplified version with just hours-per-week and date-night count inputs. The recurring holds and preferred windows are "nice to have" for launch — the optimizer works fine without them (it just has fewer soft constraints to optimize against).

### 4. Defer AI Layer for MVP

The AI layer (P8) is entirely additive. Every feature it provides has a manual fallback: preference setting via forms instead of natural language, reading satisfaction scores instead of asking "why", and using the reshuffle UI instead of describing conflicts in chat. Ship without AI, add it in a fast-follow. Save 5 days.

### 5. Combine P9 (Privacy) Into Earlier Phases

Rather than doing privacy hardening as a separate phase, write privacy boundary tests alongside the features they test. When you build the partnership API (P2.1), write the cross-pod invisibility test immediately. When you build Telegram notifications (P7.2), write the message content privacy test immediately. This is more work upfront but prevents having to refactor late.

### 6. The Optimizer Can Be Even Simpler Initially

The full MILP formulation supports event-type-specific minimums, preferred windows, recurring holds, solo time constraints, and sub-group scheduling. For the first working version, implement only:

- No double-booking (Constraint 1)
- Hard minimums (Constraint 2)
- Maximin fairness (Constraint 3)

Add event-type constraints, solo time, and preferred window bonuses as iterative improvements. This gets you to a working scheduler faster while deferring complexity.

---

## Coding Standards and Conventions

### TypeScript (API + Frontend)

- **Strict mode** everywhere. No `any` types except at serialization boundaries.
- **Zod** for all external input validation (API request bodies, query params, environment variables).
- **Drizzle ORM** for database access. No raw SQL except for RLS policy setup and migrations.
- **Hono middleware pattern** for cross-cutting concerns. Auth, pod access, privacy scrubbing, rate limiting are all middleware.
- **Error handling:** Use a custom `AppError` class with error codes. Never expose internal error details to the client. Log full errors server-side.
- Import order: Node builtins → external packages → internal packages → relative imports. No default exports except for React components.

### Python (Optimizer)

- **Pydantic v2** for all data models. Use strict mode.
- **Type hints** on all function signatures.
- **pytest** for all tests. Use fixtures for polycule configurations.
- **No database access.** The optimizer is a pure function: problem spec in, proposed schedule out. It has no side effects, no state, and no network calls (except receiving HTTP requests).
- Keep the solver code readable. Add comments explaining each constraint group. Someone reading the code should be able to understand the optimization formulation without needing to reference external documentation.

### Git Conventions

- **Branch naming:** `feat/P2.1-partner-invite`, `fix/privacy-leak-pod-members`, `refactor/calendar-aggregator`
- **Commit messages:** Reference task IDs. Example: `feat(P2.1): implement partner invite and accept flow`
- **PR structure:** One PR per task or small group of related sub-tasks. Never combine unrelated changes.
- **Never commit secrets.** The `.env` file is gitignored. Use `.env.example` with placeholder values.

### Testing

- Every API route gets an integration test that verifies: correct response for valid input, validation error for invalid input, 401 for unauthenticated access, 403 for unauthorized access.
- Privacy-sensitive endpoints get additional tests verifying cross-pod data isolation.
- The optimizer gets unit tests for each constraint group and end-to-end tests for each polycule fixture.
- Frontend components get tests for user interactions and state changes, not visual rendering.

---

## Key Technical Decisions and Rationale

These decisions are already made. Don't revisit them unless you encounter a concrete blocking issue.

| Decision | Rationale | Don't Do This Instead |
|----------|-----------|----------------------|
| Hono, not Express | Lighter, faster, better TypeScript DX, edge-ready | Don't switch to Express for familiarity |
| Drizzle, not Prisma | SQL-first, no query engine overhead, better migration control | Don't add Prisma because of its larger community — Drizzle's SQL transparency matters for RLS |
| Inline WASM HiGHS optimizer (TypeScript) | Eliminates the separate Python service. Same algorithms ported from `apps/optimizer/src/{solver,slot_discovery,models}.py` to `apps/api/src/services/optimizer/`. Saves $5/mo Railway, no HTTP hop, identical behavior validated by parity tests | Don't reach for the Python optimizer service unless you've found a problem inline can't solve. The Python source remains in-tree as the canonical reference implementation; opt back in via `OPTIMIZER_HTTP=1` env if needed for debugging |
| PostgreSQL RLS | Defense-in-depth for privacy; catches application bugs | Don't rely solely on application-level access control |
| Dual-driver adapters (DB + Redis + queue + email) | Same codebase ships to self-hosted Docker AND serverless (Vercel + Neon + Upstash); driver picked by env vars at runtime | Don't fork the codebase per deployment target — keep both paths first-class and tested |
| BullMQ for self-hosted, QStash + Vercel Cron for serverless | BullMQ needs a long-running worker process (incompatible with serverless); QStash inverts pull→push via webhook delivery with retries and delay | Don't try to run BullMQ on Vercel; don't try to run QStash without a public URL |
| Magic link auth, no passwords | Zero password liability, calendar OAuth serves double duty | Don't add password auth "for convenience" |
| Maximin fairness objective | Prevents winner-take-all scheduling, feels fair | Don't switch to utilitarian (total satisfaction) optimization — it creates unfair outcomes |
| AGPL-3.0 license (recommended) | Ensures self-hosted forks stay open, aligns with Benjamin's commons values | Don't use MIT — it allows closed-source forks that could exploit the community |

---

## Environment Variables

All required env vars are documented in `.env.example`. The critical ones:

```bash
# REQUIRED — the app won't start without these
DATABASE_URL=           # PostgreSQL connection string
                        #   self-hosted: postgresql://podlife:podlife@localhost:5433/podlife
                        #   serverless:  postgresql://USER:PASS@ep-*.neon.tech/podlife?sslmode=require
                        # *.neon.tech in URL auto-selects the Neon WS driver.
REDIS_URL=              # Self-hosted Redis URL. Ignored when UPSTASH_REDIS_REST_URL is set.
ENCRYPTION_KEY=         # 32-byte hex (openssl rand -hex 32) — NEVER lose this
APP_URL=                # Public URL of the API (for magic links and OAuth callbacks)
FRONTEND_URL=           # Public URL of the frontend (for CORS)
GOOGLE_CLIENT_ID=       # Google OAuth client ID
GOOGLE_CLIENT_SECRET=   # Google OAuth client secret

# SERVERLESS-ONLY (set these to switch transports; leave blank for self-hosted)
UPSTASH_REDIS_REST_URL= # Switches Redis transport from ioredis to @upstash/redis
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=                  # Switches job queue from BullMQ to QStash webhooks
QSTASH_CURRENT_SIGNING_KEY=    # Used to verify QStash signatures on /internal/* routes
QSTASH_NEXT_SIGNING_KEY=
CRON_SECRET=                   # Bearer secret for /api/cron/* routes (Vercel injects header)
RESEND_API_KEY=                # Switches email transport from nodemailer to Resend

# EMAIL (self-hosted; ignored if RESEND_API_KEY is set)
SMTP_HOST=
SMTP_USER=
SMTP_PASS=

# OPTIONAL — features degrade gracefully without these
TELEGRAM_BOT_TOKEN=     # Telegram bot (no bot = in-app only)
ANTHROPIC_API_KEY=      # AI features (no key = manual preference entry only)
MS_CLIENT_ID=           # Outlook calendar support
MS_CLIENT_SECRET=
MS_TENANT_ID=
OPTIMIZER_URL=          # Defaults to localhost:8000. Set to Railway URL in serverless deploys.
```

---

## Domain Vocabulary

Use these terms consistently in code, comments, and UI. Don't invent synonyms.

| Term | Meaning | Don't Call It |
|------|---------|--------------|
| **Person** | A user of the system | User, account, member (except in pod context) |
| **Partnership** | A bidirectional romantic/intimate relationship between two People | Relationship (too generic), connection, match |
| **Pod** | A named group of People in some relationship configuration | Group, team, circle, polycule (polycule is a broader concept — a pod is a specific unit within it) |
| **Need** | A hard minimum constraint ("I need at least X") | Requirement, demand, must-have |
| **Preference** | A soft target ("I'd like Y") | Want, desire, wish |
| **Time Block** | A proposed or confirmed calendar event | Event (ambiguous with JS events), appointment, slot |
| **Scheduling Cycle** | One run of the collect→optimize→propose→lock flow | Run, iteration, batch |
| **Satisfaction** | How close a person is to their ideal time allocation (0-100%) | Score, rating, happiness |
| **Reshuffle** | Rearranging locked blocks mid-cycle | Reschedule, swap, move |
| **Free Window** | A contiguous block of time when a person has no calendar conflicts | Available time, open slot, gap |
| **Candidate Slot** | A potential time block where all required participants are free | Option, possibility |

---

## Common Gotchas

1. **Partnership canonical ordering.** Partnerships store `person_a_id` and `person_b_id` with a CHECK constraint that `person_a_id < person_b_id`. This prevents duplicate partnerships (A↔B and B↔A). When creating a partnership, always sort the two UUIDs before inserting. If you forget this, you'll get unique constraint violations.

2. **Timezone handling.** All timestamps in the database are UTC (`TIMESTAMPTZ`). Timezone conversion happens at the API layer (for display) and in the optimizer (for determining what counts as "evening" or "weekend"). The `persons.timezone` field is an IANA timezone string (e.g., `America/Denver`). Never store local times.

3. **Drizzle + RLS interaction.** Before every database query in an authenticated context, you must set the RLS context: `SET LOCAL app.current_person_id = '<uuid>'`. This is done in the auth middleware (§ 5.2). If you add a new query path that bypasses the auth middleware (e.g., a background job), you must set this manually or use a service-role connection that bypasses RLS.

4. **OAuth token refresh races.** If two requests arrive simultaneously for the same user and both try to refresh an expired token, you'll get a race condition. Use a Redis lock (`SETNX`) around the token refresh operation, or accept that one refresh might fail and retry.

5. **The optimizer is stateless.** It receives the complete problem specification in every request. It does not cache anything, remember previous runs, or access the database. If you need the optimizer to consider previous schedules (e.g., for reshuffles), include `locked_blocks` in the request.

6. **BullMQ job data must be serializable.** Don't pass database model instances into job data. Pass IDs and re-fetch in the worker. Dates must be ISO strings, not Date objects.

7. **Telegram chat IDs are integers, not strings.** Telegram group chat IDs can be negative numbers. Store as `BIGINT` in PostgreSQL, not `TEXT`.

8. **Free/busy merging must handle edge cases.** Adjacent windows (one ends at 5:00, next starts at 5:00) should be merged. Windows that are fully contained within another window should be absorbed. The merge algorithm in § 6.3 handles these cases — use it as written.

---

## Definition of Done

A task is complete when:

1. The code is written and follows the conventions above.
2. Tests pass (unit tests for logic, integration tests for API routes, privacy tests for sensitive endpoints).
3. The deliverable described in the implementation plan is demonstrably working.
4. No TypeScript errors, no Python type errors, no lint warnings.
5. If it touches privacy-sensitive code, the relevant privacy boundary test from P9.1 passes.
6. The code is committed with a descriptive message referencing the task ID.

---

## When You're Stuck

- **Product ambiguity:** Check the PRD (pod-life-prd.md), particularly § 3 (User Flows) and § 7 (Frontend Design Direction).
- **Technical ambiguity:** Check the architecture doc, particularly the code samples. They are meant to be used close to verbatim.
- **Dependency confusion:** Check the dependency graph in the implementation plan (bottom of document). It maps the critical path.
- **Privacy question:** When in doubt, restrict access. It is always safer to show less data than more. You can relax privacy constraints later if users request it; you cannot un-leak data.
- **Scope creep:** If you think of a feature that isn't in the implementation plan, add it to the post-launch backlog (last section of the plan). Don't build it now.

---

*Pod Life is a project by Benjamin Life (@omniharmonic). Built with love, for love.*