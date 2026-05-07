# Pod Life

**Relationship scheduling for polyamorous families.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![CI](https://github.com/omniharmonic/pod-life/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](#)

> A scheduling and relationship-time management tool for polyamorous families.
> Connect your calendars, set how much quality time you want with each partner,
> and let a fairness-first optimizer propose schedules that actually feel fair.

<!-- TODO: replace with real screenshot -->
![Pod Life — calendar view](docs/screenshot-placeholder.png)

```bash
git clone https://github.com/omniharmonic/pod-life.git && cd pod-life
cp .env.example .env && openssl rand -hex 32 | xargs -I{} sed -i '' "s/replace_with_openssl.*/{}/" .env
docker compose up -d postgres redis && pnpm install && pnpm dev
```

---

## What is this?

Polyamorous families have a hard scheduling problem. With three, four, or more
people sharing time across overlapping relationships, finding a schedule that
feels fair to everyone is genuinely hard — and getting it wrong means real
people feel unseen.

Pod Life is a tool that takes that work seriously. You set up the people in
your life: your partners (bidirectional romantic relationships) and your pods
(named groups, which can be anything from "the whole family" to "Tuesday game
night"). You connect your calendars. You say how much quality time you'd like
with each person. A fairness-first optimizer takes everyone's calendars and
preferences and proposes a schedule.

The optimizer doesn't just find _a_ schedule — it finds the **fairest**
schedule, where "fair" is defined precisely: it maximizes the satisfaction of
the **least-satisfied** person across all relationships. No one gets steamrolled,
even when calendars are tight.

Pod Life is **privacy-first**. Information about who you spend time with stays
inside the pod it belongs to. Other partners can't see each other unless you've
chosen to share that. Defense in depth — application logic, row-level security,
and outbound message filters — guards the boundary at every layer.

This is **open-source software** (AGPL-3.0). You can self-host the entire
stack on your own infrastructure. We build for trust, not lock-in.

---

## Quick start

**Prerequisites:** Node.js 22+, pnpm 10+, Docker, Python 3.12+ (for the
optimizer), and OpenSSL.

```bash
# 1. Clone and install
git clone https://github.com/omniharmonic/pod-life.git
cd pod-life
pnpm install
cd apps/optimizer && pip install -r requirements.txt -e ".[dev]" && cd ../..

# 2. Configure environment
cp .env.example .env
# Generate an encryption key (DO NOT lose this — it secures stored OAuth tokens):
openssl rand -hex 32
# Paste it as ENCRYPTION_KEY in .env

# 3. Start data services
docker compose up -d postgres redis

# 4. Run database migrations + seed event types
pnpm --filter @pod-life/api db:migrate
pnpm --filter @pod-life/api db:seed

# 5. Start the dev stack
pnpm dev
```

Visit:

- **Web app:** http://localhost:5173
- **Marketing/welcome page:** http://localhost:5173/welcome
- **API:** http://localhost:3000
- **Optimizer:** http://localhost:8000/docs

For a complete production setup (calendar OAuth, email, Telegram, etc.) see
[SELF_HOSTING.md](./SELF_HOSTING.md).

---

## Architecture

```
Monorepo (Turborepo + pnpm workspaces)
├── apps/api          → Hono (Node.js 22) — REST API, auth, business logic
├── apps/web          → React 19 + Vite — PWA frontend
├── apps/optimizer    → Python 3.12 + FastAPI — MILP scheduling solver
└── packages/shared   → TypeScript types and Zod schemas
```

**Data stores:** PostgreSQL 16 (primary, with row-level security), Redis 7
(sessions, cache, BullMQ job queue).

**External integrations (all optional):** Google Calendar, Microsoft Outlook,
Apple iCloud (CalDAV), Telegram Bot API, Anthropic Claude.

The optimizer is a stateless microservice. It receives a problem spec via HTTP
POST and returns a proposed schedule. It has no database access. All state
lives in the API server.

```
   ┌──────────┐                    ┌──────────────┐
   │  Web /   │ ── REST + WS ───►  │  API (Hono)  │
   │   PWA    │ ◄──────────────    │              │
   └──────────┘                    └──┬─────┬─────┘
                                      │     │
                          ┌───────────▼─┐ ┌─▼──────────┐
                          │ PostgreSQL  │ │   Redis    │
                          └─────────────┘ └────────────┘
                                      │
                          ┌───────────▼────────────┐
                          │ Optimizer (FastAPI)    │
                          │  HiGHS MILP solver     │
                          └────────────────────────┘
```

---

## Tech stack

- **Frontend:** React 19, Vite, TanStack Query, Zustand, Tailwind CSS, vite-plugin-pwa
- **API:** Hono, Drizzle ORM, Zod, BullMQ, nodemailer
- **Optimizer:** FastAPI, Pydantic v2, HiGHS (via `highspy`)
- **Database:** PostgreSQL 16 with Row-Level Security
- **Cache + queue:** Redis 7
- **Auth:** Magic-link email + calendar OAuth
- **Build:** Turborepo, pnpm workspaces, TypeScript strict mode
- **Test:** Vitest, pytest, Testing Library
- **License:** AGPL-3.0

---

## Repository layout

```
pod-life/
├── apps/
│   ├── api/              REST API + auth + scheduling business logic
│   ├── optimizer/        Python MILP solver microservice
│   └── web/              React PWA
├── packages/
│   └── shared/           Shared TypeScript types and Zod schemas
├── .claude/              Project planning documents
├── .github/              CI workflows and issue/PR templates
├── docker-compose.yml    Local infrastructure (Postgres + Redis)
├── docker-compose.prod.yml  Production full-stack compose
├── CONTRIBUTING.md       How to contribute
├── SECURITY.md           Responsible disclosure
├── SELF_HOSTING.md       Self-hosting guide
└── CHANGELOG.md          Release notes
```

---

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Development environment setup
- Code style (TypeScript strict, Python type hints, no `any`, Zod for input validation)
- Commit conventions (reference task IDs from the implementation plan)
- PR process and the Definition of Done
- Testing standards

If you've discovered a security or privacy issue, please **do not** open a
public issue. Instead, follow [SECURITY.md](./SECURITY.md) for responsible
disclosure.

---

## License & attribution

Pod Life is licensed under the [GNU Affero General Public License v3.0](LICENSE).

The AGPL ensures that derivatives of Pod Life — even those run as a hosted
service — must remain open. We chose this license deliberately: a tool that
holds information about people's intimate relationships should be auditable
and ownable by the communities that use it.

This is an open-source project by **Benjamin Life ([@omniharmonic](https://github.com/omniharmonic))**.
It is not affiliated with OpenCivics or OpenCivics Labs.

Built with love, for love.
