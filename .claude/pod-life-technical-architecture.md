# Pod Life — Technical Architecture Document

**Author:** Benjamin Life (@omniharmonic)
**Version:** 0.1.0
**Date:** May 2026
**Status:** Draft — Pre-Implementation

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Database Architecture](#4-database-architecture)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Calendar Integration Layer](#6-calendar-integration-layer)
7. [Optimization Engine](#7-optimization-engine)
8. [API Architecture](#8-api-architecture)
9. [Real-Time & Event System](#9-real-time--event-system)
10. [Telegram Bot Architecture](#10-telegram-bot-architecture)
11. [AI/LLM Integration Layer](#11-aillm-integration-layer)
12. [Frontend Architecture](#12-frontend-architecture)
13. [Privacy & Security Implementation](#13-privacy--security-implementation)
14. [Infrastructure & Deployment](#14-infrastructure--deployment)
15. [Testing Strategy](#15-testing-strategy)
16. [Appendix: Key Algorithms](#16-appendix-key-algorithms)

---

## 1. System Overview

### 1.1 High-Level Architecture

Pod Life follows a **modular monolith** pattern for the primary API server, with a separate **Python microservice** for the optimization engine. This keeps the deployment simple (critical for self-hosting) while isolating the computationally distinct solver.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │   PWA        │  │  Telegram Bot    │  │  Future: Native App   │  │
│  │   (React)    │  │  (grammy)        │  │  (React Native)       │  │
│  └──────┬───────┘  └────────┬─────────┘  └───────────┬───────────┘  │
└─────────┼──────────────────┼─────────────────────────┼──────────────┘
          │                  │                         │
          ▼                  ▼                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       API GATEWAY (Hono)                             │
│  ┌────────────┐ ┌──────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │   Auth     │ │   Partner    │ │  Schedule   │ │  Telegram    │  │
│  │   Module   │ │   & Pod      │ │  Module     │ │  Webhook     │  │
│  │            │ │   Module     │ │             │ │  Handler     │  │
│  └─────┬──────┘ └──────┬───────┘ └──────┬──────┘ └──────┬───────┘  │
│        │               │               │               │           │
│  ┌─────┴───────────────┴───────────────┴───────────────┴────────┐  │
│  │                    DOMAIN SERVICES                            │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐  │  │
│  │  │ Calendar   │ │ Preference │ │ Cycle      │ │ Notifica- │  │  │
│  │  │ Sync       │ │ Engine     │ │ Manager    │ │ tion Svc  │  │  │
│  │  └────────────┘ └────────────┘ └─────┬──────┘ └───────────┘  │  │
│  └──────────────────────────────────────┼───────────────────────┘  │
└─────────────────────────────────────────┼──────────────────────────┘
                                          │ HTTP (internal)
                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    OPTIMIZATION SERVICE (Python)                      │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────────┐     │
│  │ Slot Discovery  │  │ MILP Solver  │  │ Satisfaction Scorer │     │
│  │ (candidate gen) │  │ (HiGHS)      │  │ (report generator)  │     │
│  └─────────────────┘  └──────────────┘  └─────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
          │                                          │
          ▼                                          ▼
┌──────────────────────┐              ┌───────────────────────────┐
│   PostgreSQL 16      │              │   Redis 7                 │
│   (primary data)     │              │   (sessions, pub/sub,     │
│                      │              │    job queue, cache)       │
└──────────────────────┘              └───────────────────────────┘
```

### 1.2 Data Flow: Scheduling Cycle

```
Cron / Manual Trigger
        │
        ▼
┌─ COLLECT ──────────────────────────────────────────────────────────┐
│  1. Identify all persons involved in active pods due for a cycle   │
│  2. For each person: pull free/busy from all connected calendars   │
│  3. Merge free/busy across providers into unified availability     │
│  4. Store ephemeral availability windows in Redis (TTL: 24h)       │
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
┌─ OPTIMIZE ─────────────────────────────────────────────────────────┐
│  1. Load all preferences (needs + wants) for involved persons      │
│  2. Load availability windows from Redis                           │
│  3. POST to Python optimization service with full problem spec     │
│  4. Solver returns: proposed time blocks + satisfaction scores     │
│  5. Store proposals in PostgreSQL with status='proposed'           │
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
┌─ PROPOSE ──────────────────────────────────────────────────────────┐
│  1. Push notifications to all affected persons (in-app + Telegram) │
│  2. Start review window timer (configurable, default 48h)          │
│  3. Persons review, accept, suggest changes via PWA or Telegram    │
│  4. Each change triggers a re-optimization with new constraints    │
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
┌─ LOCK ─────────────────────────────────────────────────────────────┐
│  1. Review window closes OR all participants accept                 │
│  2. Accepted proposals → status='locked'                           │
│  3. Locked blocks written back to participants' calendars           │
│  4. Confirmation notifications sent                                │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 Design Principles

- **Privacy-first:** Data minimization at every layer. Free/busy only, ephemeral storage, encrypted at rest.
- **Offline-capable:** The PWA should work offline for viewing schedules; sync when reconnected.
- **Self-hostable:** Docker Compose with no vendor-locked dependencies. All external services (calendar APIs, Telegram, Claude) are optional enhancements.
- **Configuration over code:** Relationship structures, event types, scheduling cadences, and UI themes are all data-driven, not hardcoded.
- **Graceful degradation:** The system works without AI (manual preference entry), without Telegram (in-app only), and without all calendar providers connected (manual availability entry as fallback).

---

## 2. Technology Stack

### 2.1 Stack Decisions with Rationale

| Component | Choice | Rationale | Alternatives Considered |
|-----------|--------|-----------|------------------------|
| **Runtime** | Node.js 22 (LTS) | Async I/O for calendar API calls, large ecosystem, TypeScript support | Deno (less mature ecosystem), Go (harder for solo dev) |
| **API Framework** | Hono | Edge-ready, extremely fast, lightweight, great TypeScript DX, middleware-first | Express (heavier, less modern), Fastify (good but Hono's DX is better) |
| **Frontend** | React 19 + Vite 6 | Component model fits complex UI state, huge ecosystem, PWA tooling | Svelte (smaller ecosystem), Vue (fine but React's scheduler UI libs are better) |
| **Styling** | Tailwind CSS 4 | Utility-first for rapid iteration, good responsive primitives | CSS Modules (slower iteration), Styled Components (runtime cost) |
| **ORM** | Drizzle ORM | Type-safe, SQL-first (not abstraction-heavy), great migration tooling | Prisma (heavier, query engine overhead), Knex (less type safety) |
| **Database** | PostgreSQL 16 | JSONB for flexible configs, excellent with relational graph data, row-level security | SQLite (can't handle concurrent writes well), MySQL (weaker JSONB) |
| **Cache/Queue** | Redis 7 | Session store, pub/sub for real-time, job queue (BullMQ), ephemeral data | In-memory (doesn't survive restarts), RabbitMQ (overkill) |
| **Job Queue** | BullMQ | Redis-backed, mature, retries, scheduled jobs, dashboard | Agenda (MongoDB-dependent), pg-boss (good but BullMQ is faster) |
| **Optimizer** | Python 3.12 + HiGHS | HiGHS is the fastest open-source MILP solver; Python has the best OR ecosystem | OR-Tools (heavier install), JavaScript solvers (immature) |
| **Telegram Bot** | grammy | TypeScript-native, modern API, excellent middleware, good docs | Telegraf (older, less maintained), node-telegram-bot-api (low-level) |
| **Auth** | Custom magic link + OAuth | No password liability, calendar OAuth does double duty for auth + API access | Auth0/Clerk (vendor lock-in, cost), Passport.js (works but more boilerplate) |
| **LLM** | Claude API (Anthropic) | Strong structured output, long context for schedule reasoning, tool use | OpenAI (fine but Claude's tool use is more reliable for this) |
| **PWA** | Vite PWA Plugin | Service worker generation, offline caching, installability | Workbox directly (more manual), Next.js (SSR overkill for this) |

### 2.2 System Requirements

**Minimum deployment (self-hosted):**
- 1 vCPU, 1GB RAM (API + frontend)
- 512MB RAM (Python optimizer)
- PostgreSQL instance (managed or local)
- Redis instance (managed or local)
- Total: ~$5-15/month on any VPS provider

**Reference deployment (hosted service):**
- Railway or Fly.io with auto-scaling
- Managed PostgreSQL (Neon or Supabase)
- Managed Redis (Upstash)
- Total: ~$15-30/month at low user counts

---

## 3. Repository Structure

Pod Life uses a **Turborepo monorepo** to coordinate packages while keeping deployments independent.

```
pod-life/
├── apps/
│   ├── api/                          # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point
│   │   │   ├── app.ts                # Hono app setup + middleware
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── magic-link.ts
│   │   │   │   │   └── oauth.ts
│   │   │   │   ├── persons/
│   │   │   │   │   ├── persons.routes.ts
│   │   │   │   │   ├── persons.service.ts
│   │   │   │   │   └── persons.schema.ts
│   │   │   │   ├── partners/
│   │   │   │   │   ├── partners.routes.ts
│   │   │   │   │   ├── partners.service.ts
│   │   │   │   │   └── partners.schema.ts
│   │   │   │   ├── pods/
│   │   │   │   │   ├── pods.routes.ts
│   │   │   │   │   ├── pods.service.ts
│   │   │   │   │   └── pods.schema.ts
│   │   │   │   ├── schedule/
│   │   │   │   │   ├── schedule.routes.ts
│   │   │   │   │   ├── schedule.service.ts
│   │   │   │   │   ├── cycle.manager.ts
│   │   │   │   │   └── calendar-writeback.ts
│   │   │   │   └── telegram/
│   │   │   │       ├── telegram.webhook.ts
│   │   │   │       └── telegram.bot.ts
│   │   │   ├── services/
│   │   │   │   ├── calendar/
│   │   │   │   │   ├── calendar.interface.ts
│   │   │   │   │   ├── google.provider.ts
│   │   │   │   │   ├── outlook.provider.ts
│   │   │   │   │   ├── icloud.provider.ts
│   │   │   │   │   └── calendar.aggregator.ts
│   │   │   │   ├── notification/
│   │   │   │   │   ├── notification.service.ts
│   │   │   │   │   ├── push.adapter.ts
│   │   │   │   │   └── telegram.adapter.ts
│   │   │   │   ├── encryption/
│   │   │   │   │   └── vault.ts
│   │   │   │   └── llm/
│   │   │   │       ├── llm.service.ts
│   │   │   │       └── prompts.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # Drizzle schema
│   │   │   │   ├── migrations/
│   │   │   │   └── seed.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.middleware.ts
│   │   │   │   ├── pod-access.middleware.ts
│   │   │   │   └── rate-limit.middleware.ts
│   │   │   └── lib/
│   │   │       ├── redis.ts
│   │   │       ├── config.ts
│   │   │       └── errors.ts
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                           # React PWA
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── calendar/
│   │   │   │   │   ├── WeekView.tsx
│   │   │   │   │   ├── MonthView.tsx
│   │   │   │   │   ├── TimeBlock.tsx
│   │   │   │   │   └── ProposalDiff.tsx
│   │   │   │   ├── partners/
│   │   │   │   │   ├── PartnerCard.tsx
│   │   │   │   │   ├── PreferenceEditor.tsx
│   │   │   │   │   └── SatisfactionRing.tsx
│   │   │   │   ├── pods/
│   │   │   │   │   ├── PodView.tsx
│   │   │   │   │   ├── PodSchedule.tsx
│   │   │   │   │   └── InviteFlow.tsx
│   │   │   │   ├── schedule/
│   │   │   │   │   ├── ProposalReview.tsx
│   │   │   │   │   ├── ReshuffleRequest.tsx
│   │   │   │   │   └── SatisfactionReport.tsx
│   │   │   │   └── ui/
│   │   │   │       ├── Button.tsx
│   │   │   │       ├── Card.tsx
│   │   │   │       ├── Modal.tsx
│   │   │   │       └── ProgressRing.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.ts
│   │   │   │   ├── useSchedule.ts
│   │   │   │   ├── usePartners.ts
│   │   │   │   └── usePods.ts
│   │   │   ├── stores/
│   │   │   │   └── app.store.ts       # Zustand
│   │   │   ├── lib/
│   │   │   │   ├── api.ts             # API client
│   │   │   │   └── dates.ts           # date-fns helpers
│   │   │   └── sw.ts                  # Service worker
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   └── icons/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── optimizer/                     # Python optimization service
│       ├── src/
│       │   ├── main.py                # FastAPI entry point
│       │   ├── solver.py              # MILP formulation + HiGHS
│       │   ├── models.py              # Pydantic request/response models
│       │   ├── slot_discovery.py      # Candidate time window generation
│       │   ├── satisfaction.py        # Scoring and reporting
│       │   └── utils.py
│       ├── tests/
│       │   ├── test_solver.py
│       │   ├── test_slot_discovery.py
│       │   └── fixtures/              # Synthetic polycule configs
│       ├── Dockerfile
│       ├── pyproject.toml
│       └── requirements.txt
│
├── packages/
│   └── shared/                        # Shared types and constants
│       ├── src/
│       │   ├── types.ts               # Shared TypeScript types
│       │   ├── constants.ts           # Event types, defaults
│       │   └── validation.ts          # Zod schemas shared across apps
│       └── package.json
│
├── docker-compose.yml                 # Full local dev stack
├── docker-compose.prod.yml            # Production deployment
├── turbo.json
├── package.json
├── LICENSE
├── README.md
└── CONTRIBUTING.md
```

---

## 4. Database Architecture

### 4.1 Schema Design Philosophy

The schema follows a **graph-relational hybrid** approach. People and their relationships form a graph; scheduling data is relational with temporal semantics. JSONB columns handle extensible configuration without schema sprawl.

All timestamps are stored in UTC. Timezone conversion happens at the API and frontend layers.

### 4.2 Complete Schema

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE partnership_status AS ENUM (
  'invited', 'active', 'paused', 'archived'
);

CREATE TYPE scheduling_cadence AS ENUM (
  'weekly', 'biweekly', 'monthly'
);

CREATE TYPE calendar_provider AS ENUM (
  'google', 'icloud', 'outlook'
);

CREATE TYPE time_block_status AS ENUM (
  'proposed', 'accepted', 'locked', 'declined', 'reshuffled', 'cancelled'
);

CREATE TYPE participant_response AS ENUM (
  'pending', 'accepted', 'declined', 'change_requested'
);

CREATE TYPE cycle_status AS ENUM (
  'collecting', 'optimizing', 'proposed', 'negotiating', 'locked', 'failed'
);

CREATE TYPE notification_channel AS ENUM (
  'in_app', 'telegram', 'push'
);

-- ============================================================
-- PERSONS
-- ============================================================
CREATE TABLE persons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Denver',
  telegram_chat_id BIGINT,               -- for DM bot
  telegram_handle TEXT,
  avatar_url TEXT,

  -- Global personal constraints
  solo_min_free_evenings_per_week INT NOT NULL DEFAULT 0,
  solo_min_free_weekend_days_per_month INT NOT NULL DEFAULT 0,
  blocked_windows JSONB NOT NULL DEFAULT '[]',
  -- Format: [{"day_of_week": 0, "start": "18:00", "end": "22:00", "label": "therapy"}]

  -- Notification preferences
  notification_channels notification_channel[] DEFAULT '{in_app}',

  -- Metadata
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_persons_email ON persons(email);

-- ============================================================
-- AUTH: SESSIONS AND MAGIC LINKS
-- ============================================================
CREATE TABLE magic_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,               -- bcrypt hash of token
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_magic_links_email ON magic_links(email);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_person ON sessions(person_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- CALENDAR CONNECTIONS
-- ============================================================
CREATE TABLE calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  provider calendar_provider NOT NULL,
  -- OAuth tokens encrypted with application-level AES-256-GCM
  encrypted_access_token BYTEA NOT NULL,
  encrypted_refresh_token BYTEA,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL,
  calendar_id TEXT,                       -- specific calendar to read, if multiple
  last_synced_at TIMESTAMPTZ,
  sync_error TEXT,                        -- last error message, null if healthy
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, provider)
);

CREATE INDEX idx_cal_connections_person ON calendar_connections(person_id);

-- ============================================================
-- PARTNERSHIPS (bidirectional relationships)
-- ============================================================
CREATE TABLE partnerships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_a_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  person_b_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  status partnership_status NOT NULL DEFAULT 'invited',
  invited_by UUID NOT NULL REFERENCES persons(id),
  invite_token TEXT UNIQUE,               -- for invite link acceptance
  color_a TEXT DEFAULT '#E07A5F',         -- person A's chosen color for this partner
  color_b TEXT DEFAULT '#81B29A',         -- person B's chosen color for this partner
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (person_a_id < person_b_id),      -- canonical ordering prevents duplicates
  UNIQUE (person_a_id, person_b_id)
);

CREATE INDEX idx_partnerships_persons ON partnerships(person_a_id, person_b_id);
CREATE INDEX idx_partnerships_status ON partnerships(status);

-- ============================================================
-- PARTNERSHIP PREFERENCES (per-person, per-relationship)
-- ============================================================
CREATE TABLE partnership_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  cadence scheduling_cadence NOT NULL DEFAULT 'weekly',

  -- Hard minimums (needs) — solver MUST satisfy or report infeasibility
  need_min_hours NUMERIC(5,1) NOT NULL DEFAULT 0,
  need_min_date_nights INT NOT NULL DEFAULT 0,
  need_min_overnights INT NOT NULL DEFAULT 0,

  -- Soft targets (preferences) — solver optimizes toward these
  pref_ideal_hours NUMERIC(5,1) NOT NULL DEFAULT 0,
  pref_date_nights INT NOT NULL DEFAULT 0,
  pref_overnights INT NOT NULL DEFAULT 0,
  pref_daytime_hangs INT NOT NULL DEFAULT 0,

  -- Custom event type preferences
  custom_event_prefs JSONB NOT NULL DEFAULT '[]',
  -- Format: [{"label": "movie night", "duration_hours": 2.5, "pref_count": 1}]

  -- Recurring holds: pre-assigned slots the solver must respect
  recurring_holds JSONB NOT NULL DEFAULT '[]',
  -- Format: [{"day_of_week": 2, "start": "19:00", "end": "22:00",
  --           "event_type": "date_night", "label": "Tuesday date night"}]

  -- Preferred windows: soft preference for when to schedule
  preferred_windows JSONB NOT NULL DEFAULT '[]',
  -- Format: [{"day_of_week": 5, "start": "18:00", "end": "23:00"}]

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partnership_id, person_id)
);

CREATE INDEX idx_partner_prefs_partnership ON partnership_preferences(partnership_id);
CREATE INDEX idx_partner_prefs_person ON partnership_preferences(person_id);

-- ============================================================
-- PODS
-- ============================================================
CREATE TABLE pods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  emoji TEXT DEFAULT '🏠',               -- pod icon
  scheduling_cadence scheduling_cadence NOT NULL DEFAULT 'weekly',
  planning_horizon_weeks INT NOT NULL DEFAULT 1
    CHECK (planning_horizon_weeks BETWEEN 1 AND 8),
  review_window_hours INT NOT NULL DEFAULT 48
    CHECK (review_window_hours BETWEEN 1 AND 168),
  cycle_day_of_week INT NOT NULL DEFAULT 0  -- 0=Sunday, when to trigger cycle
    CHECK (cycle_day_of_week BETWEEN 0 AND 6),
  cycle_time_of_day TIME NOT NULL DEFAULT '20:00',
  telegram_group_chat_id BIGINT,
  created_by UUID NOT NULL REFERENCES persons(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- POD MEMBERSHIP
-- ============================================================
CREATE TABLE pod_members (
  pod_id UUID NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member')),
  invite_token TEXT UNIQUE,
  joined_at TIMESTAMPTZ,                  -- null = invited but not yet joined
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pod_id, person_id)
);

CREATE INDEX idx_pod_members_person ON pod_members(person_id);

-- ============================================================
-- POD-LEVEL SCHEDULING PREFERENCES
-- ============================================================
CREATE TABLE pod_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pod_id UUID NOT NULL REFERENCES pods(id) ON DELETE CASCADE UNIQUE,

  -- Full-pod gatherings
  pref_full_gatherings_per_cycle INT NOT NULL DEFAULT 0,
  pref_gathering_duration_hours NUMERIC(4,1) NOT NULL DEFAULT 3.0,

  -- Sub-group configurations
  subgroup_configs JSONB NOT NULL DEFAULT '[]',
  -- Format: [{
  --   "label": "Brunch crew",
  --   "member_ids": ["uuid1", "uuid2", "uuid3"],
  --   "frequency_per_cycle": 1,
  --   "duration_hours": 2.5,
  --   "preferred_windows": [{"day_of_week": 6, "start": "10:00", "end": "14:00"}]
  -- }]

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHEDULING CYCLES
-- ============================================================
CREATE TABLE scheduling_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status cycle_status NOT NULL DEFAULT 'collecting',
  horizon_start TIMESTAMPTZ NOT NULL,
  horizon_end TIMESTAMPTZ NOT NULL,

  -- Who/what triggered this cycle
  triggered_by UUID REFERENCES persons(id),  -- null = system cron
  trigger_type TEXT NOT NULL DEFAULT 'automatic'
    CHECK (trigger_type IN ('automatic', 'manual', 'reshuffle')),

  -- Involved persons (denormalized for quick lookup)
  person_ids UUID[] NOT NULL DEFAULT '{}',

  -- Solver output
  solver_run_ms INT,                      -- execution time
  satisfaction_report JSONB,
  infeasibility_notes JSONB,

  -- Review window
  review_window_start TIMESTAMPTZ,
  review_window_end TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cycles_status ON scheduling_cycles(status);
CREATE INDEX idx_cycles_horizon ON scheduling_cycles(horizon_start, horizon_end);

-- ============================================================
-- TIME BLOCKS (proposed and locked schedule entries)
-- ============================================================
CREATE TABLE time_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id UUID NOT NULL REFERENCES scheduling_cycles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,               -- 'date_night', 'overnight', etc.
  event_label TEXT,                       -- optional custom label
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status time_block_status NOT NULL DEFAULT 'proposed',

  -- Context
  source_pod_id UUID REFERENCES pods(id),
  partnership_id UUID REFERENCES partnerships(id),

  -- Solver metadata
  satisfaction_contribution JSONB,
  -- Format: {"person_uuid": {"hours": 3, "type_fulfilled": "date_night"}}

  -- Calendar write-back tracking
  calendar_event_ids JSONB NOT NULL DEFAULT '{}',
  -- Format: {"person_uuid": "calendar_event_id"}

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_time_blocks_cycle ON time_blocks(cycle_id);
CREATE INDEX idx_time_blocks_status ON time_blocks(status);
CREATE INDEX idx_time_blocks_time ON time_blocks(start_time, end_time);
CREATE INDEX idx_time_blocks_partnership ON time_blocks(partnership_id);

-- ============================================================
-- TIME BLOCK PARTICIPANTS
-- ============================================================
CREATE TABLE time_block_participants (
  time_block_id UUID NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  response participant_response NOT NULL DEFAULT 'pending',
  change_note TEXT,                       -- "Can we move this to Wednesday?"
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (time_block_id, person_id)
);

CREATE INDEX idx_tb_participants_person ON time_block_participants(person_id);

-- ============================================================
-- EVENT TYPE DEFINITIONS (configurable per-system or per-pod)
-- ============================================================
CREATE TABLE event_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pod_id UUID REFERENCES pods(id) ON DELETE CASCADE,  -- null = global default
  label TEXT NOT NULL,
  emoji TEXT DEFAULT '📅',
  default_duration_hours NUMERIC(4,1) NOT NULL,
  blocks_next_morning BOOLEAN NOT NULL DEFAULT FALSE,  -- for overnights
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default event types
INSERT INTO event_types (label, emoji, default_duration_hours, blocks_next_morning, is_system, sort_order) VALUES
  ('Date Night', '🌙', 3.5, FALSE, TRUE, 1),
  ('Overnight', '🛏️', 12.0, TRUE, TRUE, 2),
  ('Daytime Hang', '☀️', 2.5, FALSE, TRUE, 3),
  ('Pod Gathering', '🏠', 3.5, FALSE, TRUE, 4),
  ('Sub-group Hang', '👥', 2.5, FALSE, TRUE, 5);

-- ============================================================
-- NOTIFICATIONS LOG
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  read_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_person ON notifications(person_id);
CREATE INDEX idx_notifications_unread ON notifications(person_id) WHERE read_at IS NULL;

-- ============================================================
-- AUDIT LOG (privacy-sensitive operations)
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID REFERENCES persons(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_person ON audit_log(person_id);
CREATE INDEX idx_audit_action ON audit_log(action);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_persons_updated BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_partnerships_updated BEFORE UPDATE ON partnerships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_partner_prefs_updated BEFORE UPDATE ON partnership_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pods_updated BEFORE UPDATE ON pods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pod_prefs_updated BEFORE UPDATE ON pod_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_cycles_updated BEFORE UPDATE ON scheduling_cycles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_time_blocks_updated BEFORE UPDATE ON time_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_cal_connections_updated BEFORE UPDATE ON calendar_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4.3 Row-Level Security Policies

PostgreSQL RLS ensures that even if application logic has a bug, data can't leak across pod boundaries.

```sql
-- Enable RLS
ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE partnership_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE pod_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see partnerships they're part of
CREATE POLICY partnership_access ON partnerships
  FOR ALL
  USING (
    person_a_id = current_setting('app.current_person_id')::UUID
    OR person_b_id = current_setting('app.current_person_id')::UUID
  );

-- Policy: users can only see pod members for pods they belong to
CREATE POLICY pod_member_access ON pod_members
  FOR SELECT
  USING (
    pod_id IN (
      SELECT pod_id FROM pod_members
      WHERE person_id = current_setting('app.current_person_id')::UUID
      AND joined_at IS NOT NULL
    )
  );

-- Policy: users can only see time blocks they participate in
CREATE POLICY time_block_access ON time_blocks
  FOR SELECT
  USING (
    id IN (
      SELECT time_block_id FROM time_block_participants
      WHERE person_id = current_setting('app.current_person_id')::UUID
    )
  );
```

---

## 5. Authentication & Authorization

### 5.1 Authentication Flow

Pod Life uses **passwordless magic link authentication** supplemented by OAuth tokens from calendar providers. No passwords are ever stored.

```typescript
// apps/api/src/modules/auth/magic-link.ts

import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { nanoid } from 'nanoid';
import { hash, compare } from 'bcryptjs';
import { db } from '../../db/schema';
import { sendEmail } from '../../services/email';

const MAGIC_LINK_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;

export async function requestMagicLink(email: string): Promise<void> {
  const token = nanoid(48);
  const tokenHash = await hash(token, 10);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);

  await db.insert(magicLinks).values({
    email: email.toLowerCase().trim(),
    tokenHash,
    expiresAt,
  });

  const link = `${process.env.APP_URL}/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

  await sendEmail({
    to: email,
    subject: 'Sign in to Pod Life 🏠',
    html: `
      <p>Hey there! Click below to sign in to Pod Life.</p>
      <a href="${link}" style="
        display: inline-block;
        padding: 12px 24px;
        background: #E07A5F;
        color: white;
        border-radius: 8px;
        text-decoration: none;
        font-family: sans-serif;
      ">Sign In</a>
      <p style="color: #888; font-size: 14px;">
        This link expires in ${MAGIC_LINK_TTL_MINUTES} minutes.
      </p>
    `,
  });
}

export async function verifyMagicLink(
  email: string,
  token: string
): Promise<{ sessionToken: string; person: Person }> {
  // Find the most recent unused magic link for this email
  const link = await db.query.magicLinks.findFirst({
    where: and(
      eq(magicLinks.email, email.toLowerCase()),
      isNull(magicLinks.usedAt),
      gt(magicLinks.expiresAt, new Date()),
    ),
    orderBy: desc(magicLinks.createdAt),
  });

  if (!link) throw new AuthError('Invalid or expired link');

  const valid = await compare(token, link.tokenHash);
  if (!valid) throw new AuthError('Invalid or expired link');

  // Mark as used
  await db.update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  // Find or create person
  let person = await db.query.persons.findFirst({
    where: eq(persons.email, email.toLowerCase()),
  });

  if (!person) {
    [person] = await db.insert(persons)
      .values({ email: email.toLowerCase(), displayName: email.split('@')[0] })
      .returning();
  }

  // Create session
  const sessionToken = nanoid(64);
  const sessionHash = await hash(sessionToken, 10);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    personId: person.id,
    tokenHash: sessionHash,
    expiresAt,
  });

  return { sessionToken, person };
}
```

### 5.2 Auth Middleware

```typescript
// apps/api/src/middleware/auth.middleware.ts

import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { db } from '../db/schema';

export const requireAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'pod_session')
    || c.req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Look up session
  const session = await db.query.sessions.findFirst({
    where: and(
      gt(sessions.expiresAt, new Date()),
    ),
    with: { person: true },
  });

  // Verify token against stored sessions for this person
  // (simplified — in production, use a session cache in Redis)
  if (!session) {
    return c.json({ error: 'Invalid session' }, 401);
  }

  // Set RLS context for database queries
  await db.execute(
    sql`SET LOCAL app.current_person_id = ${session.person.id}`
  );

  c.set('person', session.person);
  c.set('session', session);

  await next();
});
```

### 5.3 Pod Access Authorization

```typescript
// apps/api/src/middleware/pod-access.middleware.ts

import { createMiddleware } from 'hono/factory';

/**
 * Ensures the authenticated person is a member of the requested pod.
 * Must be used after requireAuth.
 */
export const requirePodMembership = createMiddleware(async (c, next) => {
  const podId = c.req.param('podId');
  const person = c.get('person');

  const membership = await db.query.podMembers.findFirst({
    where: and(
      eq(podMembers.podId, podId),
      eq(podMembers.personId, person.id),
      isNotNull(podMembers.joinedAt),
    ),
  });

  if (!membership) {
    return c.json({ error: 'Not a member of this pod' }, 403);
  }

  c.set('podMembership', membership);
  await next();
});
```

### 5.4 Calendar OAuth Flow

```typescript
// apps/api/src/modules/auth/oauth.ts

import { google } from 'googleapis';
import { encrypt, decrypt } from '../../services/encryption/vault';

// Google Calendar — Free/Busy only scope
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  // For write-back (creating events):
  'https://www.googleapis.com/auth/calendar.events',
];

export function getGoogleAuthUrl(personId: string): string {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/calendar/google/callback`
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    state: personId,  // encrypted in production
    prompt: 'consent',
  });
}

export async function handleGoogleCallback(
  code: string,
  personId: string
): Promise<void> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/calendar/google/callback`
  );

  const { tokens } = await oauth2Client.getToken(code);

  // Encrypt tokens before storage
  const encryptedAccess = await encrypt(tokens.access_token!);
  const encryptedRefresh = tokens.refresh_token
    ? await encrypt(tokens.refresh_token)
    : null;

  await db.insert(calendarConnections)
    .values({
      personId,
      provider: 'google',
      encryptedAccessToken: encryptedAccess,
      encryptedRefreshToken: encryptedRefresh,
      tokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : null,
      scopes: GOOGLE_SCOPES,
    })
    .onConflictDoUpdate({
      target: [calendarConnections.personId, calendarConnections.provider],
      set: {
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh ?? undefined,
        tokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : undefined,
      },
    });
}
```

---

## 6. Calendar Integration Layer

### 6.1 Provider Interface

All calendar providers implement a common interface, making the system provider-agnostic.

```typescript
// apps/api/src/services/calendar/calendar.interface.ts

export interface FreeBusyWindow {
  start: Date;
  end: Date;
}

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[];  // email addresses
}

export interface CalendarProvider {
  /** Fetch free/busy windows for a date range */
  getFreeBusy(
    connection: CalendarConnection,
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<FreeBusyWindow[]>;

  /** Create a calendar event (for write-back) */
  createEvent(
    connection: CalendarConnection,
    event: CalendarEvent
  ): Promise<string>;  // returns event ID

  /** Delete a calendar event */
  deleteEvent(
    connection: CalendarConnection,
    eventId: string
  ): Promise<void>;

  /** Refresh OAuth token if expired */
  refreshToken(
    connection: CalendarConnection
  ): Promise<CalendarConnection>;
}
```

### 6.2 Google Calendar Implementation

```typescript
// apps/api/src/services/calendar/google.provider.ts

import { google, calendar_v3 } from 'googleapis';
import { decrypt, encrypt } from '../encryption/vault';
import type { CalendarProvider, FreeBusyWindow, CalendarEvent } from './calendar.interface';

export class GoogleCalendarProvider implements CalendarProvider {
  private getClient(connection: CalendarConnection) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    return oauth2Client;
  }

  async getFreeBusy(
    connection: CalendarConnection,
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<FreeBusyWindow[]> {
    const client = this.getClient(connection);
    const accessToken = await decrypt(connection.encryptedAccessToken);
    client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: client });

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        items: [{ id: connection.calendarId || 'primary' }],
      },
    });

    const busyWindows = response.data.calendars?.[
      connection.calendarId || 'primary'
    ]?.busy || [];

    return busyWindows.map((window) => ({
      start: new Date(window.start!),
      end: new Date(window.end!),
    }));
  }

  async createEvent(
    connection: CalendarConnection,
    event: CalendarEvent
  ): Promise<string> {
    const client = this.getClient(connection);
    const accessToken = await decrypt(connection.encryptedAccessToken);
    client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: client });

    const response = await calendar.events.insert({
      calendarId: connection.calendarId || 'primary',
      requestBody: {
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.start.toISOString() },
        end: { dateTime: event.end.toISOString() },
        // Mark as Pod Life event for easy identification
        extendedProperties: {
          private: { podlife: 'true' },
        },
      },
    });

    return response.data.id!;
  }

  async refreshToken(connection: CalendarConnection): Promise<CalendarConnection> {
    if (!connection.encryptedRefreshToken) {
      throw new Error('No refresh token available — user must re-authenticate');
    }

    const client = this.getClient(connection);
    const refreshToken = await decrypt(connection.encryptedRefreshToken);
    client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await client.refreshAccessToken();

    const updated = await db.update(calendarConnections)
      .set({
        encryptedAccessToken: await encrypt(credentials.access_token!),
        tokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : null,
      })
      .where(eq(calendarConnections.id, connection.id))
      .returning();

    return updated[0];
  }

  async deleteEvent(connection: CalendarConnection, eventId: string): Promise<void> {
    const client = this.getClient(connection);
    const accessToken = await decrypt(connection.encryptedAccessToken);
    client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: client });
    await calendar.events.delete({
      calendarId: connection.calendarId || 'primary',
      eventId,
    });
  }
}
```

### 6.3 Free/Busy Aggregator

Merges free/busy data across multiple calendar providers and computes unified free windows.

```typescript
// apps/api/src/services/calendar/calendar.aggregator.ts

import { GoogleCalendarProvider } from './google.provider';
import { OutlookCalendarProvider } from './outlook.provider';
import { ICloudCalendarProvider } from './icloud.provider';
import type { FreeBusyWindow, CalendarProvider } from './calendar.interface';
import { redis } from '../../lib/redis';

const providers: Record<string, CalendarProvider> = {
  google: new GoogleCalendarProvider(),
  outlook: new OutlookCalendarProvider(),
  icloud: new ICloudCalendarProvider(),
};

export interface FreeWindow {
  start: Date;
  end: Date;
  durationMinutes: number;
}

/**
 * For a given person, aggregate free/busy across all connected calendars
 * and return unified FREE windows.
 */
export async function getPersonFreeWindows(
  personId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<FreeWindow[]> {
  // Check cache first
  const cacheKey = `freefbusy:${personId}:${rangeStart.toISOString()}:${rangeEnd.toISOString()}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Fetch all calendar connections for this person
  const connections = await db.query.calendarConnections.findMany({
    where: eq(calendarConnections.personId, personId),
  });

  // Aggregate busy windows from all providers
  const allBusyWindows: FreeBusyWindow[] = [];

  for (const conn of connections) {
    const provider = providers[conn.provider];
    if (!provider) continue;

    try {
      // Refresh token if needed
      let activeConn = conn;
      if (conn.tokenExpiresAt && conn.tokenExpiresAt < new Date()) {
        activeConn = await provider.refreshToken(conn);
      }

      const busy = await provider.getFreeBusy(activeConn, rangeStart, rangeEnd);
      allBusyWindows.push(...busy);
    } catch (err) {
      // Log error but continue — partial availability is better than none
      console.error(`Calendar sync error for ${conn.provider}:`, err);
      await db.update(calendarConnections)
        .set({ syncError: String(err) })
        .where(eq(calendarConnections.id, conn.id));
    }
  }

  // Also include person's blocked windows (recurring personal time)
  const person = await db.query.persons.findFirst({
    where: eq(persons.id, personId),
  });

  if (person?.blockedWindows) {
    const personalBlocks = expandRecurringWindows(
      person.blockedWindows as BlockedWindow[],
      rangeStart,
      rangeEnd,
      person.timezone,
    );
    allBusyWindows.push(...personalBlocks);
  }

  // Merge overlapping busy windows
  const mergedBusy = mergeOverlappingWindows(allBusyWindows);

  // Invert to get free windows
  const freeWindows = invertToFreeWindows(mergedBusy, rangeStart, rangeEnd);

  // Cache for 1 hour (free/busy data is relatively stable within a cycle)
  await redis.setex(cacheKey, 3600, JSON.stringify(freeWindows));

  return freeWindows;
}

/**
 * Merge overlapping or adjacent busy windows into non-overlapping intervals.
 */
function mergeOverlappingWindows(windows: FreeBusyWindow[]): FreeBusyWindow[] {
  if (windows.length === 0) return [];

  const sorted = [...windows].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  const merged: FreeBusyWindow[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start.getTime() <= last.end.getTime()) {
      // Overlapping or adjacent — extend
      last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Given a set of non-overlapping busy windows and a range,
 * compute the free windows (the gaps).
 */
function invertToFreeWindows(
  busy: FreeBusyWindow[],
  rangeStart: Date,
  rangeEnd: Date
): FreeWindow[] {
  const free: FreeWindow[] = [];
  let cursor = rangeStart;

  for (const window of busy) {
    if (cursor < window.start) {
      const durationMinutes =
        (window.start.getTime() - cursor.getTime()) / (1000 * 60);
      free.push({
        start: new Date(cursor),
        end: new Date(window.start),
        durationMinutes,
      });
    }
    cursor = new Date(Math.max(cursor.getTime(), window.end.getTime()));
  }

  // Trailing free window
  if (cursor < rangeEnd) {
    const durationMinutes =
      (rangeEnd.getTime() - cursor.getTime()) / (1000 * 60);
    free.push({
      start: new Date(cursor),
      end: new Date(rangeEnd),
      durationMinutes,
    });
  }

  return free;
}
```

---

## 7. Optimization Engine

The optimizer is a standalone Python microservice that receives a problem specification via HTTP and returns a proposed schedule. This is the computational core of Pod Life.

### 7.1 API Contract

```python
# apps/optimizer/src/models.py

from pydantic import BaseModel
from datetime import datetime
from enum import Enum

class EventType(BaseModel):
    label: str
    duration_minutes: int
    blocks_next_morning: bool = False

class FreeWindow(BaseModel):
    start: datetime
    end: datetime

class PartnerPreference(BaseModel):
    partner_id: str
    person_id: str

    # Hard minimums (needs)
    need_min_hours: float = 0
    need_min_date_nights: int = 0
    need_min_overnights: int = 0

    # Soft targets (preferences)
    pref_ideal_hours: float = 0
    pref_date_nights: int = 0
    pref_overnights: int = 0
    pref_daytime_hangs: int = 0

    # Custom types
    custom_prefs: list[dict] = []

    # Recurring holds (pre-assigned, immovable)
    recurring_holds: list[dict] = []

    # Preferred windows (soft preference for timing)
    preferred_windows: list[dict] = []

class PodGatheringPref(BaseModel):
    pod_id: str
    member_ids: list[str]
    frequency: int  # per cycle
    duration_hours: float
    preferred_windows: list[dict] = []

class SubgroupPref(BaseModel):
    label: str
    member_ids: list[str]
    frequency: int
    duration_hours: float
    preferred_windows: list[dict] = []

class PersonSpec(BaseModel):
    person_id: str
    timezone: str
    free_windows: list[FreeWindow]
    solo_min_free_evenings: int = 0
    solo_min_free_weekend_days: int = 0

class LockedBlock(BaseModel):
    """Existing locked blocks that cannot be moved (for reshuffles)."""
    start: datetime
    end: datetime
    participant_ids: list[str]

class OptimizationRequest(BaseModel):
    horizon_start: datetime
    horizon_end: datetime
    persons: list[PersonSpec]
    partner_preferences: list[PartnerPreference]
    pod_gatherings: list[PodGatheringPref] = []
    subgroup_prefs: list[SubgroupPref] = []
    event_types: list[EventType]
    locked_blocks: list[LockedBlock] = []
    slot_duration_minutes: int = 30

class ProposedBlock(BaseModel):
    event_type: str
    start: datetime
    end: datetime
    participant_ids: list[str]
    partnership_id: str | None = None
    pod_id: str | None = None
    satisfaction_contribution: dict[str, float]  # person_id -> hours

class SatisfactionScore(BaseModel):
    person_id: str
    overall_pct: float  # 0-100
    per_partner: dict[str, dict]
    # e.g. {"partner_uuid": {"need_met": true, "pref_pct": 85.0, "hours": 6.5}}
    unmet_needs: list[str]  # human-readable descriptions

class OptimizationResponse(BaseModel):
    proposed_blocks: list[ProposedBlock]
    satisfaction_scores: list[SatisfactionScore]
    infeasibility_notes: list[str]
    solver_time_ms: int
    slot_count: int
    variable_count: int
```

### 7.2 Solver Implementation

```python
# apps/optimizer/src/solver.py

import highspy
import numpy as np
from datetime import datetime, timedelta
from itertools import combinations
from models import (
    OptimizationRequest, OptimizationResponse,
    ProposedBlock, SatisfactionScore
)
from slot_discovery import discover_candidate_slots, CandidateSlot
import time

def solve(request: OptimizationRequest) -> OptimizationResponse:
    start_time = time.time()

    slot_minutes = request.slot_duration_minutes
    horizon_slots = int(
        (request.horizon_end - request.horizon_start).total_seconds()
        / 60 / slot_minutes
    )

    # ─── PHASE 1: Discover candidate slots ───────────────────────
    # For each pair/group of people, find time windows where
    # all participants are simultaneously free.
    candidates = discover_candidate_slots(request, horizon_slots)

    if not candidates:
        return OptimizationResponse(
            proposed_blocks=[],
            satisfaction_scores=_empty_scores(request),
            infeasibility_notes=["No overlapping free time found for any pair."],
            solver_time_ms=int((time.time() - start_time) * 1000),
            slot_count=horizon_slots,
            variable_count=0,
        )

    # ─── PHASE 2: Build MILP ─────────────────────────────────────
    h = highspy.Highs()
    h.silent()  # suppress solver output

    num_candidates = len(candidates)
    person_ids = [p.person_id for p in request.persons]
    person_idx = {pid: i for i, pid in enumerate(person_ids)}

    # Decision variables: x[i] = 1 if candidate slot i is selected
    # Plus: z = minimum satisfaction ratio (the value we maximize)
    num_vars = num_candidates + 1  # +1 for z (min satisfaction)
    z_idx = num_candidates  # index of the z variable

    # Variable bounds
    col_lower = np.zeros(num_vars)
    col_upper = np.ones(num_vars)
    col_upper[z_idx] = 1.0  # z ∈ [0, 1]

    # Variable types: x[i] are binary, z is continuous
    col_types = [highspy.kBinary] * num_candidates + [highspy.kContinuous]

    # Objective: maximize z (the minimum satisfaction ratio)
    col_cost = np.zeros(num_vars)
    col_cost[z_idx] = -1.0  # minimize negative z = maximize z

    h.addVars(num_vars, col_lower, col_upper)
    for i in range(num_candidates):
        h.changeColIntegrality(i, highspy.HighsIntegrality.kInteger)

    # Set objective
    h.changeColsCostByRange(0, num_vars - 1, col_cost)
    h.changeObjectiveSense(highspy.ObjSense.kMinimize)

    # ─── CONSTRAINT 1: No person double-booked ──────────────────
    # For each time slot t and person p, at most one candidate
    # that uses slot t and involves person p can be selected.
    slot_person_map: dict[tuple[int, str], list[int]] = {}
    for ci, cand in enumerate(candidates):
        for slot in range(cand.start_slot, cand.end_slot):
            for pid in cand.participant_ids:
                key = (slot, pid)
                if key not in slot_person_map:
                    slot_person_map[key] = []
                slot_person_map[key].append(ci)

    for (slot, pid), cand_indices in slot_person_map.items():
        if len(cand_indices) > 1:
            row_idx = [ci for ci in cand_indices]
            row_vals = [1.0] * len(cand_indices)
            h.addRow(0.0, 1.0, len(row_idx), row_idx, row_vals)

    # ─── CONSTRAINT 2: Hard minimums (needs) ────────────────────
    for pref in request.partner_preferences:
        if pref.need_min_hours <= 0:
            continue

        # Find all candidates for this pair
        pair = frozenset([pref.person_id, pref.partner_id])
        relevant = [
            (ci, cand) for ci, cand in enumerate(candidates)
            if frozenset(cand.participant_ids) == pair
        ]

        if not relevant:
            continue

        # Sum of hours from selected candidates >= need_min_hours
        row_idx = [ci for ci, _ in relevant]
        row_vals = [cand.duration_hours for _, cand in relevant]
        h.addRow(pref.need_min_hours, highspy.kHighsInf, len(row_idx), row_idx, row_vals)

    # ─── CONSTRAINT 3: z <= satisfaction_ratio for each person ──
    # This implements maximin fairness.
    # For each person p:
    #   z <= (sum of hours from selected candidates involving p)
    #        / (total preferred hours for p)
    for person in request.persons:
        pid = person.person_id
        # Total preferred hours for this person across all partners
        total_pref_hours = sum(
            pref.pref_ideal_hours
            for pref in request.partner_preferences
            if pref.person_id == pid and pref.pref_ideal_hours > 0
        )

        if total_pref_hours <= 0:
            continue

        # Find all candidates involving this person
        relevant = [
            (ci, cand) for ci, cand in enumerate(candidates)
            if pid in cand.participant_ids
        ]

        if not relevant:
            continue

        # Constraint: (sum of hours) / total_pref >= z
        # Rearranged: (sum of hours) - total_pref * z >= 0
        row_idx = [ci for ci, _ in relevant] + [z_idx]
        row_vals = [cand.duration_hours for _, cand in relevant] + [-total_pref_hours]
        h.addRow(0.0, highspy.kHighsInf, len(row_idx), row_idx, row_vals)

    # ─── CONSTRAINT 4: Solo/rest time ───────────────────────────
    # Ensure minimum free evenings per week for each person.
    # (Implemented by limiting total evening slots that can be scheduled.)
    for person in request.persons:
        if person.solo_min_free_evenings <= 0:
            continue

        # Count total evening slots in the horizon (18:00-23:00 = 10 slots)
        evening_candidates = [
            ci for ci, cand in enumerate(candidates)
            if person.person_id in cand.participant_ids
            and _is_evening_slot(cand, request.horizon_start, slot_minutes)
        ]

        if not evening_candidates:
            continue

        # Count total available evenings in the horizon
        weeks_in_horizon = max(1, (
            request.horizon_end - request.horizon_start
        ).days / 7)
        total_evenings = int(weeks_in_horizon * 7)
        max_scheduled_evenings = total_evenings - int(
            person.solo_min_free_evenings * weeks_in_horizon
        )

        row_idx = evening_candidates
        row_vals = [1.0] * len(evening_candidates)
        h.addRow(0.0, float(max_scheduled_evenings), len(row_idx), row_idx, row_vals)

    # ─── SOLVE ──────────────────────────────────────────────────
    h.run()

    solver_time_ms = int((time.time() - start_time) * 1000)

    if h.getInfoValue("primal_solution_status") != 2:  # 2 = feasible
        return OptimizationResponse(
            proposed_blocks=[],
            satisfaction_scores=_empty_scores(request),
            infeasibility_notes=[
                "Could not find a feasible schedule. "
                "Some needs may exceed available overlapping free time."
            ],
            solver_time_ms=solver_time_ms,
            slot_count=horizon_slots,
            variable_count=num_vars,
        )

    # ─── EXTRACT SOLUTION ───────────────────────────────────────
    solution = h.getSolution()
    col_values = list(solution.col_value)

    proposed_blocks: list[ProposedBlock] = []
    for ci, cand in enumerate(candidates):
        if col_values[ci] > 0.5:  # binary variable is 1
            block_start = request.horizon_start + timedelta(
                minutes=cand.start_slot * slot_minutes
            )
            block_end = request.horizon_start + timedelta(
                minutes=cand.end_slot * slot_minutes
            )

            contribution = {}
            for pid in cand.participant_ids:
                contribution[pid] = cand.duration_hours

            proposed_blocks.append(ProposedBlock(
                event_type=cand.event_type,
                start=block_start,
                end=block_end,
                participant_ids=list(cand.participant_ids),
                partnership_id=cand.partnership_id,
                pod_id=cand.pod_id,
                satisfaction_contribution=contribution,
            ))

    # ─── COMPUTE SATISFACTION SCORES ────────────────────────────
    satisfaction_scores = _compute_satisfaction(
        proposed_blocks, request
    )

    return OptimizationResponse(
        proposed_blocks=proposed_blocks,
        satisfaction_scores=satisfaction_scores,
        infeasibility_notes=[],
        solver_time_ms=solver_time_ms,
        slot_count=horizon_slots,
        variable_count=num_vars,
    )


def _is_evening_slot(
    cand: CandidateSlot,
    horizon_start: datetime,
    slot_minutes: int
) -> bool:
    """Check if a candidate slot falls in the evening (18:00-23:00)."""
    slot_start = horizon_start + timedelta(
        minutes=cand.start_slot * slot_minutes
    )
    return 18 <= slot_start.hour < 23


def _compute_satisfaction(
    blocks: list[ProposedBlock],
    request: OptimizationRequest,
) -> list[SatisfactionScore]:
    scores = []

    for person in request.persons:
        pid = person.person_id
        per_partner = {}
        unmet_needs = []

        for pref in request.partner_preferences:
            if pref.person_id != pid:
                continue

            pair = frozenset([pid, pref.partner_id])
            pair_hours = sum(
                b.satisfaction_contribution.get(pid, 0)
                for b in blocks
                if frozenset(b.participant_ids) == pair
            )

            need_met = pair_hours >= pref.need_min_hours
            pref_pct = (
                min(100.0, (pair_hours / pref.pref_ideal_hours) * 100)
                if pref.pref_ideal_hours > 0 else 100.0
            )

            per_partner[pref.partner_id] = {
                "need_met": need_met,
                "pref_pct": round(pref_pct, 1),
                "hours_scheduled": round(pair_hours, 1),
                "hours_wanted": pref.pref_ideal_hours,
            }

            if not need_met:
                unmet_needs.append(
                    f"Minimum {pref.need_min_hours}h with partner "
                    f"{pref.partner_id} not met (got {pair_hours:.1f}h)"
                )

        total_hours = sum(d["hours_scheduled"] for d in per_partner.values())
        total_wanted = sum(d["hours_wanted"] for d in per_partner.values())
        overall_pct = (
            min(100.0, (total_hours / total_wanted) * 100)
            if total_wanted > 0 else 100.0
        )

        scores.append(SatisfactionScore(
            person_id=pid,
            overall_pct=round(overall_pct, 1),
            per_partner=per_partner,
            unmet_needs=unmet_needs,
        ))

    return scores


def _empty_scores(request: OptimizationRequest) -> list[SatisfactionScore]:
    return [
        SatisfactionScore(
            person_id=p.person_id,
            overall_pct=0.0,
            per_partner={},
            unmet_needs=["No schedule could be generated."],
        )
        for p in request.persons
    ]
```

### 7.3 Candidate Slot Discovery

```python
# apps/optimizer/src/slot_discovery.py

from dataclasses import dataclass
from models import OptimizationRequest, FreeWindow
from itertools import combinations

@dataclass
class CandidateSlot:
    """A potential time block that could be scheduled."""
    start_slot: int        # index into the discretized time horizon
    end_slot: int          # exclusive
    duration_hours: float
    participant_ids: frozenset[str]
    event_type: str
    partnership_id: str | None = None
    pod_id: str | None = None

def discover_candidate_slots(
    request: OptimizationRequest,
    horizon_slots: int
) -> list[CandidateSlot]:
    """
    For each pair/group of people, find all time windows where
    all participants are simultaneously free and the window is
    long enough for at least one event type.
    """
    slot_minutes = request.slot_duration_minutes
    candidates: list[CandidateSlot] = []

    # Build per-person free slot bitmask for fast intersection
    person_free: dict[str, set[int]] = {}
    for person in request.persons:
        free_slots: set[int] = set()
        for window in person.free_windows:
            start_slot = int(
                (window.start - request.horizon_start).total_seconds()
                / 60 / slot_minutes
            )
            end_slot = int(
                (window.end - request.horizon_start).total_seconds()
                / 60 / slot_minutes
            )
            for s in range(max(0, start_slot), min(horizon_slots, end_slot)):
                free_slots.add(s)
        person_free[person.person_id] = free_slots

    # Remove locked blocks from free slots
    for locked in request.locked_blocks:
        lock_start = int(
            (locked.start - request.horizon_start).total_seconds()
            / 60 / slot_minutes
        )
        lock_end = int(
            (locked.end - request.horizon_start).total_seconds()
            / 60 / slot_minutes
        )
        for pid in locked.participant_ids:
            if pid in person_free:
                for s in range(lock_start, lock_end):
                    person_free[pid].discard(s)

    # Build event type lookup
    event_durations = {
        et.label: et.duration_minutes // slot_minutes
        for et in request.event_types
    }

    # ─── Generate pair candidates (for partner relationships) ───
    for pref in request.partner_preferences:
        pair_ids = frozenset([pref.person_id, pref.partner_id])

        # Check both people exist in the request
        if not all(pid in person_free for pid in pair_ids):
            continue

        # Intersect free slots
        shared_free = person_free[pref.person_id] & person_free[pref.partner_id]
        if not shared_free:
            continue

        # Find contiguous runs of shared free slots
        runs = _find_contiguous_runs(sorted(shared_free))

        # Generate candidate blocks for each event type that fits
        for run_start, run_end in runs:
            run_length = run_end - run_start
            for et in request.event_types:
                slots_needed = et.duration_minutes // slot_minutes
                if run_length < slots_needed:
                    continue

                # Slide a window of the required size across the run
                for offset in range(run_length - slots_needed + 1):
                    candidates.append(CandidateSlot(
                        start_slot=run_start + offset,
                        end_slot=run_start + offset + slots_needed,
                        duration_hours=et.duration_minutes / 60,
                        participant_ids=pair_ids,
                        event_type=et.label,
                        partnership_id=_get_partnership_id(pref),
                    ))

    # ─── Generate pod gathering candidates ──────────────────────
    for pod_pref in request.pod_gatherings:
        member_ids = frozenset(pod_pref.member_ids)
        available = [pid for pid in member_ids if pid in person_free]
        if len(available) < len(member_ids):
            continue

        # Intersect all members' free slots
        shared = person_free[available[0]]
        for pid in available[1:]:
            shared = shared & person_free[pid]

        if not shared:
            continue

        runs = _find_contiguous_runs(sorted(shared))
        slots_needed = int(pod_pref.duration_hours * 60 / slot_minutes)

        for run_start, run_end in runs:
            if run_end - run_start < slots_needed:
                continue
            for offset in range(run_end - run_start - slots_needed + 1):
                candidates.append(CandidateSlot(
                    start_slot=run_start + offset,
                    end_slot=run_start + offset + slots_needed,
                    duration_hours=pod_pref.duration_hours,
                    participant_ids=member_ids,
                    event_type="Pod Gathering",
                    pod_id=pod_pref.pod_id,
                ))

    # ─── Generate subgroup candidates ───────────────────────────
    for sub in request.subgroup_prefs:
        member_ids = frozenset(sub.member_ids)
        available = [pid for pid in member_ids if pid in person_free]
        if len(available) < len(member_ids):
            continue

        shared = person_free[available[0]]
        for pid in available[1:]:
            shared = shared & person_free[pid]

        if not shared:
            continue

        runs = _find_contiguous_runs(sorted(shared))
        slots_needed = int(sub.duration_hours * 60 / slot_minutes)

        for run_start, run_end in runs:
            if run_end - run_start < slots_needed:
                continue
            for offset in range(run_end - run_start - slots_needed + 1):
                candidates.append(CandidateSlot(
                    start_slot=run_start + offset,
                    end_slot=run_start + offset + slots_needed,
                    duration_hours=sub.duration_hours,
                    participant_ids=member_ids,
                    event_type="Sub-group Hang",
                ))

    return candidates


def _find_contiguous_runs(sorted_slots: list[int]) -> list[tuple[int, int]]:
    """Find contiguous runs in a sorted list of slot indices."""
    if not sorted_slots:
        return []

    runs = []
    run_start = sorted_slots[0]
    prev = sorted_slots[0]

    for slot in sorted_slots[1:]:
        if slot != prev + 1:
            runs.append((run_start, prev + 1))  # end is exclusive
            run_start = slot
        prev = slot

    runs.append((run_start, prev + 1))
    return runs


def _get_partnership_id(pref) -> str | None:
    """Extract partnership ID if available."""
    return getattr(pref, 'partnership_id', None)
```

### 7.4 FastAPI Service

```python
# apps/optimizer/src/main.py

from fastapi import FastAPI, HTTPException
from models import OptimizationRequest, OptimizationResponse
from solver import solve

app = FastAPI(
    title="Pod Life Optimizer",
    description="Scheduling optimization engine for polyamorous families",
    version="0.1.0",
)

@app.post("/optimize", response_model=OptimizationResponse)
async def optimize_schedule(request: OptimizationRequest):
    """
    Given people, preferences, and free/busy windows,
    propose an optimal schedule that maximizes fairness
    across all relationships.
    """
    try:
        result = solve(request)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Optimization failed: {str(e)}"
        )

@app.get("/health")
async def health():
    return {"status": "ok", "solver": "highs"}
```

---

## 8. API Architecture

### 8.1 API Application Setup

```typescript
// apps/api/src/app.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { rateLimiter } from 'hono-rate-limiter';
import { authRoutes } from './modules/auth/auth.routes';
import { personRoutes } from './modules/persons/persons.routes';
import { partnerRoutes } from './modules/partners/partners.routes';
import { podRoutes } from './modules/pods/pods.routes';
import { scheduleRoutes } from './modules/schedule/schedule.routes';
import { telegramWebhook } from './modules/telegram/telegram.webhook';
import { requireAuth } from './middleware/auth.middleware';

const app = new Hono();

// ─── Global Middleware ─────────────────────────────────────
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Rate limiting: 100 requests per minute per IP
app.use('*', rateLimiter({
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: (c) => c.req.header('x-forwarded-for') || 'unknown',
}));

// ─── Public Routes ─────────────────────────────────────────
app.route('/auth', authRoutes);
app.route('/telegram/webhook', telegramWebhook);

app.get('/health', (c) => c.json({ status: 'ok' }));

// ─── Protected Routes ──────────────────────────────────────
app.use('/api/*', requireAuth);
app.route('/api/me', personRoutes);
app.route('/api/partners', partnerRoutes);
app.route('/api/pods', podRoutes);
app.route('/api/schedule', scheduleRoutes);

export default app;
```

### 8.2 Invite Routes (unified partner + pod)

Partner and pod invites share a single API surface — `/api/invites` — because the lifecycle (mint → preview → accept | revoke) is identical regardless of what's on the other side of the bearer token. Kind-specific resource creation lives in `partners.service` and `pods.service` as `materialize*FromInvite` helpers that the invite service dispatches to.

**Route map:**

| Method | Path                                | Auth | Purpose                                                  |
|--------|-------------------------------------|------|----------------------------------------------------------|
| POST   | `/api/invites`                      | yes  | Mint invite. Body discriminated by `kind`.               |
| GET    | `/api/invites`                      | yes  | List invites I created (with status + my displayHint).   |
| GET    | `/api/invites/:token/preview`       | **no** | Public landing-page lookup. Leaks only `kind`, inviter display name, pod name. |
| POST   | `/api/invites/:token/accept`        | yes  | Accept. Dispatches by `kind`. Self-accept returns 400.   |
| DELETE | `/api/invites/:token`               | yes  | Revoke (inviter only). Cannot revoke after acceptance.   |

The preview route is mounted directly on `app` (outside the authed `/api` group) so cold invitees — those with no Person yet — can render the landing page and decide whether to sign up. Cold signup-on-accept reuses the standard login-code flow: the landing page links to `/login?next=/join/:token`, the login page honors a same-origin `next` param, and after first `auth.verify` (which auto-creates a Person) the user lands back on the invite page to complete acceptance.

```typescript
// apps/api/src/modules/invites/invites.routes.ts (excerpt)

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createInviteSchema } from '@pod-life/shared';
import { acceptInvite, createInvite, getInvitePreview, listMyInvites, revokeInvite } from './invites.service.js';

// Public — mounted directly on app at /api/invites BEFORE the authed group.
export const invitesPublicRoutes = new Hono();
invitesPublicRoutes.get('/:token/preview', async (c) => {
  return c.json(await getInvitePreview(c.req.param('token')));
});

// Authed — mounted inside the api group.
export const invitesRoutes = new Hono();
invitesRoutes.post('/', zValidator('json', createInviteSchema), async (c) => {
  const me = c.get('person');
  return c.json(await createInvite(me.id, c.req.valid('json')));
});
invitesRoutes.get('/', async (c) => c.json({ invites: await listMyInvites(c.get('person').id) }));
invitesRoutes.post('/:token/accept', async (c) => {
  const me = c.get('person');
  return c.json(await acceptInvite(me.id, c.req.param('token')));
});
invitesRoutes.delete('/:token', async (c) => {
  const me = c.get('person');
  await revokeInvite(me.id, c.req.param('token'));
  return c.json({ ok: true });
});
```

**Body schema (Zod discriminated union — see packages/shared/src/validation.ts):**

```typescript
export const createInviteSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('partner'),
    relationshipType: z.enum(['partnership', 'friendship']).default('partnership'),
    displayHint: z.string().min(1).max(80).optional(),
  }),
  z.object({
    kind: z.literal('pod'),
    podId: z.string().uuid(),
    displayHint: z.string().min(1).max(80).optional(),
  }),
]);
```

**`invites` table schema** (replaces the older split `partner_invites` and Redis-based pod tokens — migration `0007_unified_invites.sql`):

```sql
CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  token text NOT NULL UNIQUE,
  kind text NOT NULL,                                 -- 'partner' | 'pod'
  invited_by uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  pod_id uuid REFERENCES pods(id) ON DELETE CASCADE,  -- NULL for partner
  relationship_type text,                             -- NULL for pod; 'partnership'|'friendship' for partner
  invitee_display_hint text,                          -- inviter-private label, NEVER exposed to accepter
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES persons(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_kind_check CHECK (kind IN ('partner', 'pod')),
  CONSTRAINT invites_pod_kind_consistency CHECK (
    (kind = 'pod' AND pod_id IS NOT NULL AND relationship_type IS NULL)
    OR
    (kind = 'partner' AND pod_id IS NULL AND relationship_type IN ('partnership', 'friendship'))
  )
);
```

**Privacy contract for preview (CLAUDE.md § Privacy Model):** the public preview response is restricted to `{ kind, inviterDisplayName, podName?, relationshipType?, expiresAt }`. Specifically:

- ❌ Never the inviter's `inviteeDisplayHint` (it's a label they wrote for *themselves* to recognize outstanding invites).
- ❌ Never pod members other than the inviter (revealing membership would leak who's in the pod to anyone with a link, including link-finders who weren't intended recipients).
- ❌ Never the inviter's other partnerships / other pods.
- ✓ The pod *name* IS exposed (it's a property of the invitation itself: "join Pod X").
- ✓ The inviter's display name IS exposed (so the accepter knows whose invite they're opening).

The accept side is more lenient because the user is authenticated by then; they get the partnership id or pod id they just joined, and the standard pod/partner access rules apply from that point.

**Pods are horizontal (key authorization decision):** any pod member can mint an invite to that pod, not just the creator. The pod-membership check in `createInvite` is defense-in-depth on top of the route-layer membership check — never gated on `role='admin'`. This matches the product intent that pods are collective spaces, not owned-by-one-person rooms.

**Partner-only legacy routes** previously documented here (`POST /api/partners/invite`, `POST /api/partners/accept/:token`) have been removed in favor of the unified surface. `partners.service` retains `createPartnerInvite` and `materializePartnershipFromInvite` as internal helpers called by the invite service.

// PATCH /api/partners/:id/preferences
// Update scheduling preferences for a partner
partnerRoutes.patch(
  '/:id/preferences',
  zValidator('json', z.object({
    cadence: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
    needMinHours: z.number().min(0).optional(),
    needMinDateNights: z.number().int().min(0).optional(),
    needMinOvernights: z.number().int().min(0).optional(),
    prefIdealHours: z.number().min(0).optional(),
    prefDateNights: z.number().int().min(0).optional(),
    prefOvernights: z.number().int().min(0).optional(),
    prefDaytimeHangs: z.number().int().min(0).optional(),
    recurringHolds: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      start: z.string(),
      end: z.string(),
      eventType: z.string(),
      label: z.string().optional(),
    })).optional(),
    preferredWindows: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      start: z.string(),
      end: z.string(),
    })).optional(),
  })),
  async (c) => {
    const person = c.get('person');
    const partnershipId = c.req.param('id');
    const body = c.req.valid('json');

    // Verify person is part of this partnership
    const partnership = await db.query.partnerships.findFirst({
      where: and(
        eq(partnerships.id, partnershipId),
        or(
          eq(partnerships.personAId, person.id),
          eq(partnerships.personBId, person.id),
        ),
      ),
    });

    if (!partnership) {
      return c.json({ error: 'Partnership not found' }, 404);
    }

    const updated = await db.update(partnershipPreferences)
      .set({
        ...(body.cadence && { cadence: body.cadence }),
        ...(body.needMinHours !== undefined && { needMinHours: body.needMinHours }),
        ...(body.needMinDateNights !== undefined && { needMinDateNights: body.needMinDateNights }),
        ...(body.needMinOvernights !== undefined && { needMinOvernights: body.needMinOvernights }),
        ...(body.prefIdealHours !== undefined && { prefIdealHours: body.prefIdealHours }),
        ...(body.prefDateNights !== undefined && { prefDateNights: body.prefDateNights }),
        ...(body.prefOvernights !== undefined && { prefOvernights: body.prefOvernights }),
        ...(body.prefDaytimeHangs !== undefined && { prefDaytimeHangs: body.prefDaytimeHangs }),
        ...(body.recurringHolds !== undefined && { recurringHolds: body.recurringHolds }),
        ...(body.preferredWindows !== undefined && { preferredWindows: body.preferredWindows }),
      })
      .where(and(
        eq(partnershipPreferences.partnershipId, partnershipId),
        eq(partnershipPreferences.personId, person.id),
      ))
      .returning();

    return c.json({ preferences: updated[0] });
  }
);

// GET /api/partners
// List all my partnerships with summary info
partnerRoutes.get('/', async (c) => {
  const person = c.get('person');

  const myPartnerships = await db.query.partnerships.findMany({
    where: and(
      or(
        eq(partnerships.personAId, person.id),
        eq(partnerships.personBId, person.id),
      ),
      eq(partnerships.status, 'active'),
    ),
    with: {
      personA: { columns: { id: true, displayName: true, avatarUrl: true } },
      personB: { columns: { id: true, displayName: true, avatarUrl: true } },
      preferences: {
        where: eq(partnershipPreferences.personId, person.id),
      },
    },
  });

  // Transform to show partner info (not self)
  const result = myPartnerships.map((p) => {
    const partner = p.personAId === person.id ? p.personB : p.personA;
    return {
      partnershipId: p.id,
      partner,
      myPreferences: p.preferences[0] || null,
      color: p.personAId === person.id ? p.colorA : p.colorB,
    };
  });

  return c.json({ partners: result });
});

export { partnerRoutes };
```

### 8.3 Schedule Cycle Routes

```typescript
// apps/api/src/modules/schedule/schedule.routes.ts

import { Hono } from 'hono';
import { CycleManager } from './cycle.manager';

const scheduleRoutes = new Hono();

// POST /api/schedule/run
// Manually trigger an optimization cycle
scheduleRoutes.post('/run', async (c) => {
  const person = c.get('person');

  const cycleManager = new CycleManager();
  const cycle = await cycleManager.triggerCycle(person.id, 'manual');

  return c.json({
    cycleId: cycle.id,
    status: cycle.status,
    horizonStart: cycle.horizonStart,
    horizonEnd: cycle.horizonEnd,
    message: 'Optimization cycle started. You will be notified when proposals are ready.',
  });
});

// GET /api/schedule/proposals
// Get current proposals for the authenticated person
scheduleRoutes.get('/proposals', async (c) => {
  const person = c.get('person');

  const activeProposals = await db.query.timeBlocks.findMany({
    where: and(
      inArray(timeBlocks.status, ['proposed', 'accepted']),
      exists(
        db.select().from(timeBlockParticipants)
          .where(and(
            eq(timeBlockParticipants.timeBlockId, timeBlocks.id),
            eq(timeBlockParticipants.personId, person.id),
          ))
      ),
    ),
    with: {
      participants: {
        with: {
          person: { columns: { id: true, displayName: true, avatarUrl: true } },
        },
      },
      cycle: {
        columns: {
          satisfactionReport: true,
          reviewWindowEnd: true,
        },
      },
    },
    orderBy: asc(timeBlocks.startTime),
  });

  // Get person's satisfaction score from the cycle
  const cycleId = activeProposals[0]?.cycleId;
  let satisfaction = null;
  if (cycleId) {
    const cycle = await db.query.schedulingCycles.findFirst({
      where: eq(schedulingCycles.id, cycleId),
    });
    if (cycle?.satisfactionReport) {
      satisfaction = (cycle.satisfactionReport as any[])
        .find((s: any) => s.person_id === person.id);
    }
  }

  return c.json({
    proposals: activeProposals,
    satisfaction,
    reviewWindowEnd: activeProposals[0]?.cycle?.reviewWindowEnd,
  });
});

// POST /api/schedule/proposals/:id/respond
// Accept or decline a proposed time block
scheduleRoutes.post('/proposals/:id/respond', async (c) => {
  const person = c.get('person');
  const blockId = c.req.param('id');
  const { response, changeNote } = await c.req.json();

  // Validate response
  if (!['accepted', 'declined', 'change_requested'].includes(response)) {
    return c.json({ error: 'Invalid response' }, 400);
  }

  await db.update(timeBlockParticipants)
    .set({
      response,
      changeNote: changeNote || null,
      respondedAt: new Date(),
    })
    .where(and(
      eq(timeBlockParticipants.timeBlockId, blockId),
      eq(timeBlockParticipants.personId, person.id),
    ));

  // Check if all participants have accepted
  const allResponses = await db.query.timeBlockParticipants.findMany({
    where: eq(timeBlockParticipants.timeBlockId, blockId),
  });

  const allAccepted = allResponses.every((r) => r.response === 'accepted');
  if (allAccepted) {
    await db.update(timeBlocks)
      .set({ status: 'accepted' })
      .where(eq(timeBlocks.id, blockId));
  }

  // If change requested, notify other participants
  if (response === 'change_requested') {
    const block = await db.query.timeBlocks.findFirst({
      where: eq(timeBlocks.id, blockId),
      with: { participants: { with: { person: true } } },
    });

    for (const participant of block!.participants) {
      if (participant.personId !== person.id) {
        await notificationService.send(participant.personId, {
          title: 'Schedule change requested',
          body: `${person.displayName} requested a change: ${changeNote}`,
          actionUrl: `/schedule/proposals/${blockId}`,
        });
      }
    }
  }

  return c.json({ status: 'updated' });
});

export { scheduleRoutes };
```

### 8.4 Cycle Manager

```typescript
// apps/api/src/modules/schedule/cycle.manager.ts

import { Queue } from 'bullmq';
import { redis } from '../../lib/redis';

const optimizerQueue = new Queue('optimizer', { connection: redis });

export class CycleManager {
  /**
   * Trigger a full scheduling cycle for a person and all their
   * connected pods/partnerships.
   */
  async triggerCycle(
    personId: string,
    triggerType: 'automatic' | 'manual' | 'reshuffle'
  ) {
    // 1. Determine the horizon based on pod configurations
    const pods = await this.getPersonPods(personId);
    const horizon = this.computeHorizon(pods);

    // 2. Identify all persons involved
    const involvedPersonIds = await this.getInvolvedPersonIds(personId);

    // 3. Create cycle record
    const [cycle] = await db.insert(schedulingCycles).values({
      status: 'collecting',
      horizonStart: horizon.start,
      horizonEnd: horizon.end,
      triggeredBy: triggerType === 'automatic' ? null : personId,
      triggerType,
      personIds: involvedPersonIds,
    }).returning();

    // 4. Enqueue the optimization job
    await optimizerQueue.add('run-cycle', {
      cycleId: cycle.id,
      personIds: involvedPersonIds,
      horizonStart: horizon.start.toISOString(),
      horizonEnd: horizon.end.toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return cycle;
  }

  /**
   * BullMQ worker handler: runs the full collect → optimize → propose pipeline.
   */
  async processCycle(job: { data: CycleJobData }) {
    const { cycleId, personIds, horizonStart, horizonEnd } = job.data;

    // ─── COLLECT ─────────────────────────────────────────────
    await db.update(schedulingCycles)
      .set({ status: 'collecting' })
      .where(eq(schedulingCycles.id, cycleId));

    const personSpecs = [];
    for (const pid of personIds) {
      const freeWindows = await getPersonFreeWindows(
        pid,
        new Date(horizonStart),
        new Date(horizonEnd)
      );
      const person = await db.query.persons.findFirst({
        where: eq(persons.id, pid),
      });

      personSpecs.push({
        person_id: pid,
        timezone: person!.timezone,
        free_windows: freeWindows.map((w) => ({
          start: w.start.toISOString(),
          end: w.end.toISOString(),
        })),
        solo_min_free_evenings: person!.soloMinFreeEveningsPerWeek,
        solo_min_free_weekend_days: person!.soloMinFreeWeekendDaysPerMonth,
      });
    }

    // Load all relevant preferences
    const partnerPrefs = await this.loadPartnerPreferences(personIds);
    const podGatherings = await this.loadPodGatheringPrefs(personIds);
    const subgroupPrefs = await this.loadSubgroupPrefs(personIds);
    const eventTypes = await this.loadEventTypes();
    const lockedBlocks = await this.loadLockedBlocks(
      new Date(horizonStart),
      new Date(horizonEnd),
      personIds
    );

    // ─── OPTIMIZE ────────────────────────────────────────────
    await db.update(schedulingCycles)
      .set({ status: 'optimizing' })
      .where(eq(schedulingCycles.id, cycleId));

    const optimizerResponse = await fetch(
      `${process.env.OPTIMIZER_URL}/optimize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          horizon_start: horizonStart,
          horizon_end: horizonEnd,
          persons: personSpecs,
          partner_preferences: partnerPrefs,
          pod_gatherings: podGatherings,
          subgroup_prefs: subgroupPrefs,
          event_types: eventTypes,
          locked_blocks: lockedBlocks,
        }),
      }
    );

    const result = await optimizerResponse.json();

    // ─── PROPOSE ─────────────────────────────────────────────
    // Store proposed blocks
    for (const block of result.proposed_blocks) {
      const [timeBlock] = await db.insert(timeBlocks).values({
        cycleId,
        eventType: block.event_type,
        startTime: new Date(block.start),
        endTime: new Date(block.end),
        status: 'proposed',
        sourcePodId: block.pod_id || null,
        partnershipId: block.partnership_id || null,
        satisfactionContribution: block.satisfaction_contribution,
      }).returning();

      for (const pid of block.participant_ids) {
        await db.insert(timeBlockParticipants).values({
          timeBlockId: timeBlock.id,
          personId: pid,
          response: 'pending',
        });
      }
    }

    // Calculate review window
    const pod = await this.getEarliestPod(personIds);
    const reviewHours = pod?.reviewWindowHours || 48;
    const reviewWindowEnd = new Date(
      Date.now() + reviewHours * 60 * 60 * 1000
    );

    // Update cycle
    await db.update(schedulingCycles).set({
      status: 'proposed',
      satisfactionReport: result.satisfaction_scores,
      infeasibilityNotes: result.infeasibility_notes,
      solverRunMs: result.solver_time_ms,
      reviewWindowStart: new Date(),
      reviewWindowEnd,
    }).where(eq(schedulingCycles.id, cycleId));

    // ─── NOTIFY ──────────────────────────────────────────────
    for (const pid of personIds) {
      const score = result.satisfaction_scores
        .find((s: any) => s.person_id === pid);

      await notificationService.send(pid, {
        title: '📅 New schedule proposal',
        body: score
          ? `Your schedule is ${score.overall_pct}% of your ideal. Tap to review.`
          : 'A new schedule has been proposed. Tap to review.',
        actionUrl: '/schedule/proposals',
        channels: ['in_app', 'telegram'],
      });
    }

    // Schedule auto-lock job
    await optimizerQueue.add('auto-lock', { cycleId }, {
      delay: reviewHours * 60 * 60 * 1000,
    });
  }
}
```

---

## 9. Real-Time & Event System

### 9.1 Event Bus Architecture

Pod Life uses Redis Pub/Sub for real-time updates and BullMQ for durable background jobs.

```typescript
// apps/api/src/services/events/event-bus.ts

import { Redis } from 'ioredis';

type EventType =
  | 'schedule.proposed'
  | 'schedule.accepted'
  | 'schedule.locked'
  | 'schedule.reshuffle_requested'
  | 'partner.invited'
  | 'partner.accepted'
  | 'pod.member_joined'
  | 'preference.updated';

interface PodLifeEvent {
  type: EventType;
  personId: string;       // who triggered
  affectedPersonIds: string[];  // who should be notified
  payload: Record<string, any>;
  timestamp: string;
}

const pubClient = new Redis(process.env.REDIS_URL!);
const subClient = new Redis(process.env.REDIS_URL!);

export function publish(event: PodLifeEvent): void {
  pubClient.publish('podlife:events', JSON.stringify(event));
}

export function subscribe(
  handler: (event: PodLifeEvent) => Promise<void>
): void {
  subClient.subscribe('podlife:events');
  subClient.on('message', async (channel, message) => {
    if (channel === 'podlife:events') {
      const event = JSON.parse(message) as PodLifeEvent;
      await handler(event);
    }
  });
}
```

### 9.2 Server-Sent Events for PWA

```typescript
// apps/api/src/modules/realtime/sse.ts

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { subscribe } from '../../services/events/event-bus';

const realtimeRoutes = new Hono();

realtimeRoutes.get('/events', async (c) => {
  const person = c.get('person');

  return streamSSE(c, async (stream) => {
    const handler = async (event: any) => {
      if (event.affectedPersonIds.includes(person.id)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.payload),
        });
      }
    };

    subscribe(handler);

    // Keep alive
    const keepAlive = setInterval(async () => {
      await stream.writeSSE({ event: 'ping', data: '' });
    }, 30_000);

    stream.onAbort(() => clearInterval(keepAlive));
  });
});

export { realtimeRoutes };
```

### 9.3 Background Job Definitions

```typescript
// apps/api/src/jobs/index.ts

import { Worker, Queue } from 'bullmq';
import { redis } from '../lib/redis';
import { CycleManager } from '../modules/schedule/cycle.manager';

// ─── Cron jobs ─────────────────────────────────────────────
const cronQueue = new Queue('cron', { connection: redis });

// Schedule weekly cycle triggers
// Runs every Sunday at 20:00 UTC — checks which pods need cycles
await cronQueue.add('weekly-cycle-check', {}, {
  repeat: { pattern: '0 20 * * 0' },  // every Sunday 8pm UTC
});

// Clean up expired sessions and magic links
await cronQueue.add('cleanup', {}, {
  repeat: { pattern: '0 3 * * *' },  // daily at 3am UTC
});

// ─── Workers ───────────────────────────────────────────────
const optimizerWorker = new Worker('optimizer', async (job) => {
  const cycleManager = new CycleManager();

  switch (job.name) {
    case 'run-cycle':
      await cycleManager.processCycle(job);
      break;

    case 'auto-lock':
      await cycleManager.autoLockCycle(job.data.cycleId);
      break;
  }
}, { connection: redis, concurrency: 2 });

const cronWorker = new Worker('cron', async (job) => {
  switch (job.name) {
    case 'weekly-cycle-check':
      await checkAndTriggerPodCycles();
      break;

    case 'cleanup':
      await cleanupExpiredData();
      break;
  }
}, { connection: redis });
```

---

## 10. Telegram Bot Architecture

### 10.1 Bot Setup and Command Structure

```typescript
// apps/api/src/modules/telegram/telegram.bot.ts

import { Bot, Context, session, InlineKeyboard } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// ─── Middleware ─────────────────────────────────────────────
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// ─── Commands ──────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const linkToken = ctx.match;  // from /start <token>

  if (linkToken) {
    // Link Telegram account to Pod Life account
    const person = await linkTelegramAccount(ctx.from!.id, linkToken);
    if (person) {
      await ctx.reply(
        `Hey ${person.displayName}! 🏠 Your Telegram is now linked to Pod Life.\n\n` +
        `I'll send you schedule proposals and updates here. You can also:\n` +
        `• /schedule — see your upcoming schedule\n` +
        `• /preferences — adjust time preferences\n` +
        `• /status — see your satisfaction scores`
      );
    } else {
      await ctx.reply('Hmm, that link doesn\'t seem valid. Try generating a new one from Pod Life settings.');
    }
  } else {
    await ctx.reply(
      'Welcome to Pod Life! 🏠\n\n' +
      'To get started, link your account from the Pod Life app under Settings → Telegram.'
    );
  }
});

bot.command('schedule', async (ctx) => {
  const person = await getPersonByTelegramId(ctx.from!.id);
  if (!person) return ctx.reply('Please link your account first with /start');

  const upcoming = await getUpcomingBlocks(person.id, 7); // next 7 days

  if (upcoming.length === 0) {
    return ctx.reply('No scheduled time blocks this week. Run /preferences to set up your ideal week!');
  }

  let message = '📅 *Your upcoming week:*\n\n';
  for (const block of upcoming) {
    const partnerNames = block.participants
      .filter((p: any) => p.personId !== person.id)
      .map((p: any) => p.person.displayName)
      .join(', ');

    const emoji = getEventEmoji(block.eventType);
    const day = formatDay(block.startTime, person.timezone);
    const time = formatTime(block.startTime, block.endTime, person.timezone);

    message += `${emoji} *${day}* ${time}\n`;
    message += `   ${block.eventType} with ${partnerNames}\n`;
    message += `   _${block.status}_\n\n`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  const person = await getPersonByTelegramId(ctx.from!.id);
  if (!person) return ctx.reply('Please link your account first.');

  const satisfaction = await getPersonSatisfaction(person.id);

  let message = '💝 *Your relationship time status:*\n\n';
  for (const [partnerId, data] of Object.entries(satisfaction.perPartner)) {
    const partner = await getPersonById(partnerId as string);
    const pct = (data as any).pref_pct;
    const bar = generateProgressBar(pct);

    message += `${partner!.displayName}: ${bar} ${pct}%\n`;
    message += `   ${(data as any).hours_scheduled}h of ${(data as any).hours_wanted}h\n\n`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ─── Inline responses to proposals ─────────────────────────
bot.callbackQuery(/^proposal:(accept|decline|change):(.+)$/, async (ctx) => {
  const [, action, blockId] = ctx.match!;
  const person = await getPersonByTelegramId(ctx.from!.id);

  if (!person) {
    return ctx.answerCallbackQuery('Account not linked.');
  }

  switch (action) {
    case 'accept':
      await respondToProposal(blockId, person.id, 'accepted');
      await ctx.answerCallbackQuery('Accepted! ✅');
      await ctx.editMessageReplyMarkup(undefined);
      break;

    case 'decline':
      await respondToProposal(blockId, person.id, 'declined');
      await ctx.answerCallbackQuery('Declined.');
      break;

    case 'change':
      await ctx.answerCallbackQuery('Send me what change you\'d like:');
      // Next message from this user will be treated as change note
      await setAwaitingChangeNote(person.id, blockId);
      break;
  }
});

// ─── Privacy-scoped pod notifications ──────────────────────
export async function notifyPodGroup(
  podId: string,
  message: string,
  excludePersonId?: string
) {
  const pod = await db.query.pods.findFirst({
    where: eq(pods.id, podId),
  });

  if (!pod?.telegramGroupChatId) return;

  // PRIVACY: Only send pod-scoped information to pod group chats
  // Never mention partners or pods that are outside this pod's context
  await bot.api.sendMessage(pod.telegramGroupChatId, message, {
    parse_mode: 'Markdown',
  });
}

export async function notifyPersonDM(
  personId: string,
  message: string,
  keyboard?: InlineKeyboard
) {
  const person = await db.query.persons.findFirst({
    where: eq(persons.id, personId),
  });

  if (!person?.telegramChatId) return;

  await bot.api.sendMessage(person.telegramChatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

function generateProgressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getEventEmoji(type: string): string {
  const map: Record<string, string> = {
    'Date Night': '🌙',
    'Overnight': '🛏️',
    'Daytime Hang': '☀️',
    'Pod Gathering': '🏠',
    'Sub-group Hang': '👥',
  };
  return map[type] || '📅';
}

export { bot };
```

### 10.2 Proposal Notification Flow

```typescript
// When a new schedule proposal is ready, the bot sends personalized DMs
// and a summary to pod group chats.

export async function sendProposalNotifications(
  cycleId: string,
  personIds: string[]
) {
  const cycle = await db.query.schedulingCycles.findFirst({
    where: eq(schedulingCycles.id, cycleId),
  });

  for (const pid of personIds) {
    const blocks = await getPersonProposals(pid, cycleId);
    const score = (cycle!.satisfactionReport as any[])
      ?.find((s: any) => s.person_id === pid);

    let message = '📅 *New schedule proposal!*\n\n';

    if (score) {
      message += `Overall: ${generateProgressBar(score.overall_pct)} ${score.overall_pct}%\n\n`;
    }

    for (const block of blocks) {
      const partners = block.participants
        .filter((p: any) => p.personId !== pid)
        .map((p: any) => p.person.displayName)
        .join(', ');

      const day = formatDay(block.startTime);
      const time = formatTime(block.startTime, block.endTime);
      message += `${getEventEmoji(block.eventType)} ${day} ${time} — ${block.eventType} with ${partners}\n`;
    }

    message += '\nReview in the app or respond here:';

    // Build inline keyboard with accept/decline for each block
    const keyboard = new InlineKeyboard();
    keyboard
      .text('✅ Accept All', `proposal:accept_all:${cycleId}`)
      .text('📅 Open App', `proposal:open:${cycleId}`);

    await notifyPersonDM(pid, message, keyboard);
  }
}
```

---

## 11. AI/LLM Integration Layer

### 11.1 Service Architecture

The LLM layer provides natural language understanding and generation but is not required for core functionality. All AI features degrade gracefully to manual input.

```typescript
// apps/api/src/services/llm/llm.service.ts

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are the Pod Life scheduling assistant. You help people 
in polyamorous relationships manage their quality time with partners and pods.

Your tone is warm, supportive, and practical. You understand the complexity and 
beauty of non-traditional relationship structures. You never judge relationship 
configurations.

When parsing preferences, extract structured data. When explaining schedules, 
be specific about times and people. When someone is frustrated about scheduling 
conflicts, be empathetic first, practical second.

You have access to the user's preference and schedule data via tool calls.
Never reveal information about partners or pods that the user is not part of.`;

export class LLMService {
  /**
   * Parse natural language preference input into structured data.
   * Example: "I want to see Alex about twice a week, mostly evenings"
   * → { partnerId: "...", prefIdealHours: 7, prefDateNights: 2, preferredWindows: [...] }
   */
  async parsePreferences(
    personId: string,
    naturalLanguageInput: string,
    partnerContext: PartnerContext[]
  ): Promise<ParsedPreferences> {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Parse the following preference statement into structured scheduling data.

Available partners: ${JSON.stringify(partnerContext.map(p => ({
  id: p.id, name: p.displayName
})))}

Statement: "${naturalLanguageInput}"

Respond with JSON only, no explanation:
{
  "partner_id": "uuid or null if ambiguous",
  "pref_ideal_hours": number,
  "pref_date_nights": number,
  "pref_overnights": number,
  "pref_daytime_hangs": number,
  "preferred_windows": [{"day_of_week": 0-6, "start": "HH:MM", "end": "HH:MM"}],
  "need_min_hours": number or null,
  "confidence": 0-1,
  "clarification_needed": "string or null"
}`
      }],
    });

    const text = response.content[0].type === 'text'
      ? response.content[0].text : '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }

  /**
   * Explain why a schedule looks the way it does.
   * Used when someone asks "Why didn't I get X this week?"
   */
  async explainSchedule(
    personId: string,
    question: string,
    scheduleContext: ScheduleContext
  ): Promise<string> {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `A user is asking about their schedule. Here's the context:

Their preferences: ${JSON.stringify(scheduleContext.preferences)}
Their satisfaction scores: ${JSON.stringify(scheduleContext.satisfaction)}
Proposed schedule: ${JSON.stringify(scheduleContext.blocks)}
Infeasibility notes: ${JSON.stringify(scheduleContext.infeasibilityNotes)}

Their question: "${question}"

Give a warm, clear explanation. Be specific about what constrained the schedule.
If there's a suggestion for how they could adjust preferences to get better results, mention it gently.`
      }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text : '';
  }

  /**
   * Handle a reshuffle request in natural language.
   * Example: "Something came up Thursday evening, can we move the date night?"
   */
  async parseReshuffleRequest(
    personId: string,
    request: string,
    currentSchedule: TimeBlock[]
  ): Promise<ReshuffleIntent> {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Parse this reshuffle request. Current schedule:
${JSON.stringify(currentSchedule.map(b => ({
  id: b.id,
  type: b.eventType,
  start: b.startTime,
  end: b.endTime,
  with: b.participants.map((p: any) => p.person.displayName),
})))}

Request: "${request}"

Respond with JSON:
{
  "affected_block_id": "uuid of the block to move",
  "reason": "brief reason",
  "constraint": "what time is now unavailable",
  "suggestion": "any specific alternative mentioned, or null"
}`
      }],
    });

    const text = response.content[0].type === 'text'
      ? response.content[0].text : '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }
}
```

---

## 12. Frontend Architecture

### 12.1 State Management

```typescript
// apps/web/src/stores/app.store.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Partner {
  partnershipId: string;
  partner: { id: string; displayName: string; avatarUrl?: string };
  myPreferences: PartnershipPreferences | null;
  color: string;
}

interface TimeBlock {
  id: string;
  eventType: string;
  startTime: string;
  endTime: string;
  status: string;
  participants: Array<{
    personId: string;
    person: { displayName: string; avatarUrl?: string };
    response: string;
  }>;
  partnershipId?: string;
  sourcePodId?: string;
}

interface AppState {
  // Auth
  person: Person | null;
  isAuthenticated: boolean;

  // Data
  partners: Partner[];
  pods: Pod[];
  currentProposals: TimeBlock[];
  lockedSchedule: TimeBlock[];
  satisfaction: SatisfactionScore | null;

  // UI
  activeView: 'calendar' | 'partners' | 'pods' | 'settings';
  selectedWeek: Date;
  proposalReviewOpen: boolean;

  // Actions
  setAuth: (person: Person) => void;
  logout: () => void;
  setPartners: (partners: Partner[]) => void;
  setPods: (pods: Pod[]) => void;
  setProposals: (proposals: TimeBlock[]) => void;
  respondToProposal: (blockId: string, response: string) => Promise<void>;
  navigateWeek: (direction: 'prev' | 'next') => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      person: null,
      isAuthenticated: false,
      partners: [],
      pods: [],
      currentProposals: [],
      lockedSchedule: [],
      satisfaction: null,
      activeView: 'calendar',
      selectedWeek: new Date(),
      proposalReviewOpen: false,

      setAuth: (person) => set({ person, isAuthenticated: true }),
      logout: () => set({
        person: null,
        isAuthenticated: false,
        partners: [],
        pods: [],
      }),
      setPartners: (partners) => set({ partners }),
      setPods: (pods) => set({ pods }),
      setProposals: (proposals) => set({ currentProposals: proposals }),

      respondToProposal: async (blockId, response) => {
        await api.post(`/schedule/proposals/${blockId}/respond`, { response });
        const proposals = get().currentProposals.map((p) =>
          p.id === blockId
            ? { ...p, status: response === 'accepted' ? 'accepted' : p.status }
            : p
        );
        set({ currentProposals: proposals });
      },

      navigateWeek: (direction) => {
        const current = get().selectedWeek;
        const delta = direction === 'next' ? 7 : -7;
        set({
          selectedWeek: new Date(
            current.getTime() + delta * 24 * 60 * 60 * 1000
          ),
        });
      },
    }),
    {
      name: 'podlife-store',
      partialize: (state) => ({
        person: state.person,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
```

### 12.2 Calendar View Component

```tsx
// apps/web/src/components/calendar/WeekView.tsx

import { useMemo } from 'react';
import { useAppStore } from '../../stores/app.store';
import { TimeBlock } from './TimeBlock';
import { startOfWeek, addDays, format, isSameDay } from 'date-fns';

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7am - 10pm

export function WeekView() {
  const { selectedWeek, currentProposals, lockedSchedule, partners, navigateWeek } =
    useAppStore();

  const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 }); // Monday
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const allBlocks = useMemo(
    () => [...currentProposals, ...lockedSchedule],
    [currentProposals, lockedSchedule]
  );

  const getPartnerColor = (block: any) => {
    const partnership = partners.find(
      (p) => p.partnershipId === block.partnershipId
    );
    return partnership?.color || '#94A3B8';
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Week Navigation */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-200">
        <button
          onClick={() => navigateWeek('prev')}
          className="p-2 rounded-full hover:bg-stone-100 transition-colors"
        >
          ←
        </button>
        <h2 className="font-medium text-stone-800">
          {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
        </h2>
        <button
          onClick={() => navigateWeek('next')}
          className="p-2 rounded-full hover:bg-stone-100 transition-colors"
        >
          →
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-stone-200 bg-white">
        <div /> {/* Spacer for time column */}
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`text-center py-2 text-sm ${
              isSameDay(day, new Date())
                ? 'text-terracotta-600 font-semibold'
                : 'text-stone-500'
            }`}
          >
            <div className="text-xs uppercase">{format(day, 'EEE')}</div>
            <div className="text-lg">{format(day, 'd')}</div>
          </div>
        ))}
      </div>

      {/* Time Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {/* Hour labels */}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-xs text-stone-400 text-right pr-2 h-16 border-b border-stone-100"
              style={{ gridColumn: 1 }}
            >
              {format(new Date(2024, 0, 1, hour), 'h a')}
            </div>
          ))}

          {/* Day columns with blocks */}
          {days.map((day, dayIdx) => (
            <div
              key={day.toISOString()}
              className="relative border-l border-stone-100"
              style={{
                gridColumn: dayIdx + 2,
                gridRow: `1 / ${HOURS.length + 1}`,
              }}
            >
              {/* Hour grid lines */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-16 border-b border-stone-100"
                />
              ))}

              {/* Time blocks */}
              {allBlocks
                .filter((block) =>
                  isSameDay(new Date(block.startTime), day)
                )
                .map((block) => (
                  <TimeBlock
                    key={block.id}
                    block={block}
                    color={getPartnerColor(block)}
                    dayStart={new Date(day.setHours(7, 0, 0, 0))}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### 12.3 Satisfaction Ring Component

```tsx
// apps/web/src/components/ui/SatisfactionRing.tsx

interface SatisfactionRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

export function SatisfactionRing({
  percentage,
  size = 64,
  strokeWidth = 4,
  color = '#E07A5F',
  label,
}: SatisfactionRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E7E5E4"
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="text-sm font-medium text-stone-700">
        {Math.round(percentage)}%
      </span>
      {label && (
        <span className="text-xs text-stone-400">{label}</span>
      )}
    </div>
  );
}
```

### 12.4 PWA Configuration

```typescript
// apps/web/vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pod Life',
        short_name: 'Pod Life',
        description: 'Relationship scheduling for polyamorous families',
        theme_color: '#E07A5F',
        background_color: '#FAF9F6',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.podlife\.app\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
});
```

---

## 13. Privacy & Security Implementation

### 13.1 Encryption at Rest

```typescript
// apps/api/src/services/encryption/vault.ts

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export async function encrypt(plaintext: string): Promise<Buffer> {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: [iv (16)] [authTag (16)] [ciphertext (...)]
  return Buffer.concat([iv, authTag, encrypted]);
}

export async function decrypt(data: Buffer): Promise<string> {
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const ciphertext = data.subarray(32);

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
```

### 13.2 Privacy Middleware

```typescript
// apps/api/src/middleware/privacy.middleware.ts

/**
 * Scrubs any response to ensure no cross-pod data leakage.
 * Applied to all API responses that include person or schedule data.
 */
export const privacyScrub = createMiddleware(async (c, next) => {
  await next();

  const person = c.get('person');
  if (!person || !c.res.headers.get('content-type')?.includes('json')) return;

  const body = await c.res.json();
  const scrubbed = deepScrub(body, person.id);

  c.res = new Response(JSON.stringify(scrubbed), {
    status: c.res.status,
    headers: c.res.headers,
  });
});

function deepScrub(obj: any, currentPersonId: string): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => deepScrub(item, currentPersonId));
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Never expose other people's preferences
      if (key === 'otherPersonPreferences') continue;

      // Never expose partnership/pod IDs from other contexts
      if (key === 'externalPodIds') continue;

      // Never expose telegram IDs of other people
      if (key === 'telegramChatId' && obj.id !== currentPersonId) continue;

      result[key] = deepScrub(value, currentPersonId);
    }
    return result;
  }
  return obj;
}
```

### 13.3 Data Retention and Deletion

```typescript
// apps/api/src/services/data-lifecycle.ts

export async function deleteAccount(personId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Delete all calendar connections (tokens)
    await tx.delete(calendarConnections)
      .where(eq(calendarConnections.personId, personId));

    // 2. Remove from all pods
    await tx.delete(podMembers)
      .where(eq(podMembers.personId, personId));

    // 3. Archive partnerships (other person sees "Deleted User")
    await tx.update(partnerships)
      .set({ status: 'archived' })
      .where(or(
        eq(partnerships.personAId, personId),
        eq(partnerships.personBId, personId),
      ));

    // 4. Delete preferences
    await tx.delete(partnershipPreferences)
      .where(eq(partnershipPreferences.personId, personId));

    // 5. Remove from time block participants
    await tx.delete(timeBlockParticipants)
      .where(eq(timeBlockParticipants.personId, personId));

    // 6. Delete notifications
    await tx.delete(notifications)
      .where(eq(notifications.personId, personId));

    // 7. Anonymize audit log
    await tx.update(auditLog)
      .set({ personId: null, metadata: {} })
      .where(eq(auditLog.personId, personId));

    // 8. Delete the person record
    await tx.delete(persons)
      .where(eq(persons.id, personId));

    // 9. Clear all Redis caches for this person
    const keys = await redis.keys(`*:${personId}:*`);
    if (keys.length) await redis.del(...keys);
  });
}
```

---

## 14. Infrastructure & Deployment

### 14.1 Docker Compose (Production)

```yaml
# docker-compose.prod.yml

version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://podlife:${DB_PASSWORD}@postgres:5432/podlife
      - REDIS_URL=redis://redis:6379
      - OPTIMIZER_URL=http://optimizer:8000
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - APP_URL=${APP_URL}
      - FRONTEND_URL=${FRONTEND_URL}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s

  optimizer:
    build:
      context: .
      dockerfile: apps/optimizer/Dockerfile
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
    deploy:
      resources:
        limits:
          memory: 512M

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "5173:80"
    depends_on:
      - api
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=podlife
      - POSTGRES_USER=podlife
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U podlife"]
      interval: 10s
      timeout: 5s
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
```

### 14.2 Environment Configuration

```bash
# .env.example

# ─── Core ───────────────────────────────────────────────
APP_URL=https://podlife.app
FRONTEND_URL=https://podlife.app
NODE_ENV=production

# ─── Database ───────────────────────────────────────────
DATABASE_URL=postgresql://podlife:password@localhost:5432/podlife
DB_PASSWORD=change-me-in-production

# ─── Redis ──────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ─── Encryption (generate: openssl rand -hex 32) ───────
ENCRYPTION_KEY=your-256-bit-hex-key

# ─── Google OAuth ───────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ─── Microsoft OAuth (Outlook) ──────────────────────────
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=

# ─── Telegram ──────────────────────────────────────────
TELEGRAM_BOT_TOKEN=

# ─── Anthropic (optional — AI features) ────────────────
ANTHROPIC_API_KEY=

# ─── Email (for magic links) ──────────────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=hello@podlife.app

# ─── Optimizer ─────────────────────────────────────────
OPTIMIZER_URL=http://localhost:8000
```

---

## 15. Testing Strategy

### 15.1 Test Matrix

| Layer | Tool | Coverage Target | What's Tested |
|-------|------|----------------|---------------|
| Optimizer (Python) | pytest | 95%+ | Solver correctness, edge cases, infeasibility |
| API (Node.js) | Vitest | 80%+ | Routes, services, auth flows |
| Frontend (React) | Vitest + Testing Library | 70%+ | Components, hooks, store |
| Integration | Playwright | Key flows | Onboarding, preference setting, proposal review |
| Privacy | Custom audit tests | 100% of boundaries | Cross-pod leakage, data scrubbing |

### 15.2 Optimizer Test Fixtures

```python
# apps/optimizer/tests/fixtures/polycule_configs.py

"""
Synthetic polycule configurations for testing the optimizer.
Each configuration tests a different topological challenge.
"""

def triad_basic():
    """A, B, C all partnered with each other. Classic triad."""
    return {
        "persons": [
            {"person_id": "A", "timezone": "America/Denver",
             "free_windows": evening_windows("A", 7)},
            {"person_id": "B", "timezone": "America/Denver",
             "free_windows": evening_windows("B", 7)},
            {"person_id": "C", "timezone": "America/Denver",
             "free_windows": evening_windows("C", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 6, "pref_date_nights": 2},
            {"person_id": "A", "partner_id": "C", "pref_ideal_hours": 6, "pref_date_nights": 2},
            {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 6, "pref_date_nights": 2},
            {"person_id": "B", "partner_id": "C", "pref_ideal_hours": 4, "pref_date_nights": 1},
            {"person_id": "C", "partner_id": "A", "pref_ideal_hours": 6, "pref_date_nights": 2},
            {"person_id": "C", "partner_id": "B", "pref_ideal_hours": 4, "pref_date_nights": 1},
        ],
        "pod_gatherings": [
            {"pod_id": "pod1", "member_ids": ["A", "B", "C"],
             "frequency": 1, "duration_hours": 3},
        ],
    }

def v_structure():
    """A is partnered with B and C, but B and C are not partners.
    Tests that B and C don't see each other's schedule details."""
    return {
        "persons": [
            {"person_id": "A", "timezone": "America/Denver",
             "free_windows": evening_windows("A", 7)},
            {"person_id": "B", "timezone": "America/Denver",
             "free_windows": evening_windows("B", 7)},
            {"person_id": "C", "timezone": "America/Denver",
             "free_windows": evening_windows("C", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B", "pref_ideal_hours": 8,
             "need_min_hours": 4, "pref_date_nights": 2},
            {"person_id": "A", "partner_id": "C", "pref_ideal_hours": 8,
             "need_min_hours": 4, "pref_date_nights": 2},
            {"person_id": "B", "partner_id": "A", "pref_ideal_hours": 10,
             "need_min_hours": 6, "pref_date_nights": 3},
            {"person_id": "C", "partner_id": "A", "pref_ideal_hours": 6,
             "need_min_hours": 3, "pref_date_nights": 1},
        ],
    }

def multi_pod_conflict():
    """A is in Pod1 (with B) and Pod2 (with C).
    Tests cross-pod optimization where A's time is contested."""
    return {
        "persons": [
            {"person_id": "A", "timezone": "America/Denver",
             "free_windows": limited_windows("A", 4)},  # only 4 free evenings
            {"person_id": "B", "timezone": "America/Denver",
             "free_windows": evening_windows("B", 7)},
            {"person_id": "C", "timezone": "America/Denver",
             "free_windows": evening_windows("C", 7)},
        ],
        "partner_preferences": [
            {"person_id": "A", "partner_id": "B",
             "pref_ideal_hours": 8, "need_min_hours": 3},
            {"person_id": "A", "partner_id": "C",
             "pref_ideal_hours": 8, "need_min_hours": 3},
            {"person_id": "B", "partner_id": "A",
             "pref_ideal_hours": 10, "need_min_hours": 5},
            {"person_id": "C", "partner_id": "A",
             "pref_ideal_hours": 10, "need_min_hours": 5},
        ],
    }
    # Expected: A's 4 evenings split ~50/50 between B and C
    # B and C both can't get 5h minimum — infeasibility reported

def oversubscribed():
    """A has 4 partners, each wanting 8h/week. Total demand: 32h.
    Available: ~20h. Tests graceful degradation and maximin fairness."""
    return {
        "persons": [
            {"person_id": "A", "timezone": "America/Denver",
             "free_windows": evening_windows("A", 7)},
            *[{"person_id": f"P{i}", "timezone": "America/Denver",
               "free_windows": evening_windows(f"P{i}", 7)} for i in range(1, 5)],
        ],
        "partner_preferences": [
            *[{"person_id": "A", "partner_id": f"P{i}",
               "pref_ideal_hours": 8, "need_min_hours": 2} for i in range(1, 5)],
            *[{"person_id": f"P{i}", "partner_id": "A",
               "pref_ideal_hours": 8, "need_min_hours": 2} for i in range(1, 5)],
        ],
    }
    # Expected: each partner gets ~5h (equal split), all needs met,
    # overall satisfaction ~62% for A, ~62% for each partner

def timezone_mismatch():
    """A in Denver, B in London, C in Tokyo.
    Tests that the solver works in UTC and finds viable overlap windows."""
    return {
        "persons": [
            {"person_id": "A", "timezone": "America/Denver",
             "free_windows": evening_windows_tz("A", "America/Denver", 7)},
            {"person_id": "B", "timezone": "Europe/London",
             "free_windows": evening_windows_tz("B", "Europe/London", 7)},
            {"person_id": "C", "timezone": "Asia/Tokyo",
             "free_windows": evening_windows_tz("C", "Asia/Tokyo", 7)},
        ],
    }
```

### 15.3 Privacy Boundary Tests

```python
# apps/optimizer/tests/test_privacy_boundaries.py

"""
These tests verify that the API never leaks information across pod boundaries.
They are the most critical tests in the system.
"""

import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_partner_invisible_across_pods(client: AsyncClient):
    """Person A is in Pod1 with B and Pod2 with C.
    B should not see any evidence of C's existence."""

    # Setup: A, B, C with appropriate pods
    a_token = await create_and_auth("A")
    b_token = await create_and_auth("B")
    c_token = await create_and_auth("C")

    # A creates partnerships with B and C
    await create_partnership(a_token, b_token)
    await create_partnership(a_token, c_token)

    # A creates Pod1 with B, Pod2 with C
    pod1 = await create_pod(a_token, "Pod1", [b_token])
    pod2 = await create_pod(a_token, "Pod2", [c_token])

    # B queries A's partnerships — should only see B↔A
    resp = await client.get("/api/partners", headers=auth_header(b_token))
    partners = resp.json()["partners"]
    partner_ids = [p["partner"]["id"] for p in partners]
    assert "A" in partner_ids
    assert "C" not in partner_ids

    # B queries Pod1 members — should not see C
    resp = await client.get(f"/api/pods/{pod1}/members", headers=auth_header(b_token))
    member_ids = [m["personId"] for m in resp.json()["members"]]
    assert "A" in member_ids
    assert "B" in member_ids
    assert "C" not in member_ids

    # B should not be able to access Pod2 at all
    resp = await client.get(f"/api/pods/{pod2}", headers=auth_header(b_token))
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_schedule_opacity(client: AsyncClient):
    """When A's time is allocated to C, B should see it as 'unavailable'
    but not see C's name or the event type."""

    # Run optimization cycle that allocates Tuesday to A+C
    # Then check what B sees for A's Tuesday
    resp = await client.get("/api/schedule/proposals", headers=auth_header(b_token))
    # B should only see blocks they participate in
    for block in resp.json()["proposals"]:
        participant_ids = [p["personId"] for p in block["participants"]]
        assert b_id in participant_ids  # B only sees their own blocks
```

---

## 16. Appendix: Key Algorithms

### 16.1 Maximin Fairness

The core optimization objective. Instead of maximizing total satisfaction (which could mean one person gets 95% and another gets 40%), we maximize the satisfaction of the worst-off person.

```
Objective: maximize z
Subject to: z ≤ satisfaction_ratio(p) for all persons p

Where satisfaction_ratio(p) = 
  (total scheduled hours for p across all partners) 
  / (total preferred hours stated by p)
```

This guarantees that the optimizer will sacrifice a small improvement for one person if it means a larger improvement for the person who's currently getting the least.

### 16.2 Recurring Hold Expansion

Converts abstract recurring rules ("every Tuesday 7-10pm") into concrete time windows within the planning horizon.

```python
def expand_recurring_windows(
    holds: list[dict],
    horizon_start: datetime,
    horizon_end: datetime,
    timezone: str
) -> list[FreeBusyWindow]:
    import pytz
    tz = pytz.timezone(timezone)
    windows = []
    
    current = horizon_start.astimezone(tz)
    while current < horizon_end:
        for hold in holds:
            if current.weekday() == hold["day_of_week"]:
                start_h, start_m = map(int, hold["start"].split(":"))
                end_h, end_m = map(int, hold["end"].split(":"))
                
                window_start = current.replace(
                    hour=start_h, minute=start_m, second=0
                )
                window_end = current.replace(
                    hour=end_h, minute=end_m, second=0
                )
                
                if window_end > window_start:
                    windows.append(FreeBusyWindow(
                        start=window_start.astimezone(pytz.UTC),
                        end=window_end.astimezone(pytz.UTC),
                    ))
        
        current += timedelta(days=1)
    
    return windows
```

### 16.3 Satisfaction Gap Analysis

When the optimizer can't fully satisfy everyone, this generates human-readable explanations.

```python
def analyze_gaps(
    scores: list[SatisfactionScore],
    request: OptimizationRequest
) -> list[str]:
    insights = []
    
    for score in scores:
        if score.overall_pct >= 90:
            continue
            
        pid = score.person_id
        person_prefs = [
            p for p in request.partner_preferences
            if p.person_id == pid
        ]
        
        total_desired = sum(p.pref_ideal_hours for p in person_prefs)
        person_spec = next(
            p for p in request.persons if p.person_id == pid
        )
        total_free_hours = sum(
            w.duration_minutes for w in person_spec.free_windows
        ) / 60
        
        if total_desired > total_free_hours * 0.8:
            insights.append(
                f"Your desired time ({total_desired:.0f}h) is close to your "
                f"total free time ({total_free_hours:.0f}h). Consider reducing "
                f"preferences or freeing up calendar space."
            )
        
        for partner_id, data in score.per_partner.items():
            if not data["need_met"]:
                partner_spec = next(
                    (p for p in request.persons if p.person_id == partner_id),
                    None
                )
                if partner_spec:
                    shared_free = _count_shared_hours(
                        person_spec, partner_spec
                    )
                    insights.append(
                        f"You and your partner only share {shared_free:.0f}h "
                        f"of overlapping free time this cycle, but your minimum "
                        f"need is {data.get('hours_wanted', '?')}h."
                    )
    
    return insights
```

---

*Pod Life is a project by Benjamin Life (@omniharmonic). Built with love, for love.*
