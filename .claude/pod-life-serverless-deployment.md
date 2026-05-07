# Pod Life — Serverless Deployment Architecture

**Author:** Benjamin Life (@omniharmonic)
**Version:** 0.1.0
**Date:** May 2026

---

## Purpose of This Document

This document replaces the Hetzner VPS deployment strategy with a serverless-first approach using Vercel, Neon, and Upstash. It also serves as a **change manifest** — every section references the specific parts of the existing project documents (Technical Architecture, Implementation Plan, CLAUDE.md) that need updating to reflect this approach.

---

## The Stack

| Layer | Service | Tier | Monthly Cost |
|-------|---------|------|-------------|
| Frontend (static PWA) | Vercel | Free | $0 |
| API (Hono functions) | Vercel Functions | Free / Pro | $0–20 |
| Database | Neon PostgreSQL | Free (0.5GB) → Launch ($19) | $0–19 |
| Cache & Sessions | Upstash Redis | Free (10k commands/day) | $0 |
| Job Scheduling | Upstash QStash + Vercel Cron | Free | $0 |
| Optimizer (primary) | Vercel Functions (WASM HiGHS) | Same as API | $0 |
| Optimizer (fallback) | Railway (Python container) | Pro ($5 base) | $5 |
| Email (magic links) | Resend | Free (100/day) | $0 |

**Total at launch: $0–5/month.** Scales to $20–40/month under moderate usage before any optimization is needed.

---

## Architecture Overview

```
                         Internet
                            │
                            ▼
                    ┌───────────────┐
                    │    Vercel     │
                    │   Edge CDN   │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     ┌────────────┐ ┌────────────┐ ┌────────────────┐
     │  Static    │ │  API       │ │  Optimizer     │
     │  PWA       │ │  Functions │ │  Function      │
     │  (React)   │ │  (Hono)    │ │  (WASM HiGHS)  │
     └────────────┘ └─────┬──────┘ └────────┬───────┘
                          │                  │
              ┌───────────┼──────────────────┘
              │           │
              ▼           ▼
     ┌────────────┐ ┌────────────┐
     │   Neon     │ │  Upstash   │
     │ PostgreSQL │ │   Redis    │
     │ (serverless│ │ (serverless│
     │  pooling)  │ │  + QStash) │
     └────────────┘ └────────────┘
```

The key shift: instead of long-running processes on a VPS, every component scales to zero when idle and spins up on demand. The API server isn't a server at all — it's a collection of functions that Vercel invokes per-request.

---

## Component Details

### 1. Frontend — Vercel Static

No change from the existing architecture. Vite builds the React PWA to static assets. Vercel serves them from its edge CDN with automatic cache invalidation on deploy.

```
Build command:  cd apps/web && pnpm build
Output dir:     apps/web/dist
Framework:      Vite
```

The PWA manifest, service worker, and offline caching all work identically. Vercel's edge network is faster than self-hosted nginx for global users.

### 2. API — Hono on Vercel Functions

Hono has a first-class Vercel adapter. The application code stays almost identical — the only change is the entry point.

```typescript
// apps/api/src/vercel.ts (new file — Vercel entry point)

import { handle } from 'hono/vercel';
import app from './app';

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const PUT = handle(app);
```

```json
// apps/api/vercel.json

{
  "functions": {
    "src/vercel.ts": {
      "runtime": "@vercel/node@3",
      "maxDuration": 30
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": "/src/vercel.ts" }
  ]
}
```

The existing `app.ts` with all its routes and middleware stays the same. Hono abstracts the runtime — it doesn't care whether it's running on Node.js, Vercel Functions, or Cloudflare Workers.

**Function duration limits:**
- Vercel Hobby: 10 seconds per invocation
- Vercel Pro: 60 seconds per invocation

Most API calls complete in under 1 second. The calendar sync (multiple external API calls) might take 3–5 seconds for a user with several calendars. The scheduling cycle orchestration function needs Pro tier for the 60-second limit, since it coordinates calendar collection + optimizer call + database writes.

> **Update Required → Technical Architecture § 8.1**
> Add the Vercel entry point alongside the existing standalone server entry. The `app.ts` stays the same — add `vercel.ts` as an alternative entry point.

### 3. Optimizer — Two-Track Strategy

The optimizer is the one component that doesn't map trivially to serverless. The strategy is to try the simpler approach first and have a fallback ready.

#### Primary: WASM HiGHS on Vercel Functions

The `highs-solver` npm package compiles HiGHS to WebAssembly, making it runnable in any JavaScript environment including Vercel Functions. This eliminates the separate Python service entirely.

```typescript
// apps/api/src/services/optimizer/solver.ts (TypeScript port of the Python solver)

import Highs from 'highs-solver';

interface SolverResult {
  proposedBlocks: ProposedBlock[];
  satisfactionScores: SatisfactionScore[];
  infeasibilityNotes: string[];
  solverTimeMs: number;
}

export async function solve(request: OptimizationRequest): Promise<SolverResult> {
  const startTime = performance.now();
  const highs = await Highs();

  const slotMinutes = request.slotDurationMinutes;
  const horizonSlots = Math.floor(
    (request.horizonEnd.getTime() - request.horizonStart.getTime())
    / (60 * 1000 * slotMinutes)
  );

  // Phase 1: Discover candidate slots (same algorithm as Python version)
  const candidates = discoverCandidateSlots(request, horizonSlots);

  if (candidates.length === 0) {
    return {
      proposedBlocks: [],
      satisfactionScores: emptyScores(request),
      infeasibilityNotes: ['No overlapping free time found for any pair.'],
      solverTimeMs: Math.round(performance.now() - startTime),
    };
  }

  // Phase 2: Build MILP problem as LP format string
  // HiGHS WASM accepts problems in LP format
  const numCandidates = candidates.length;
  const zIdx = numCandidates; // min satisfaction variable

  let problem = 'Maximize\n  obj: z\nSubject To\n';
  let constraintCount = 0;

  // Constraint 1: No person double-booked
  const slotPersonMap = buildSlotPersonMap(candidates);
  for (const [key, candIndices] of slotPersonMap.entries()) {
    if (candIndices.length > 1) {
      const terms = candIndices.map(ci => `x${ci}`).join(' + ');
      problem += `  c${constraintCount++}: ${terms} <= 1\n`;
    }
  }

  // Constraint 2: Hard minimums (needs)
  for (const pref of request.partnerPreferences) {
    if (pref.needMinHours <= 0) continue;
    const pair = new Set([pref.personId, pref.partnerId]);
    const relevant = candidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => setsEqual(new Set(c.participantIds), pair));

    if (relevant.length === 0) continue;

    const terms = relevant
      .map(({ c, i }) => `${c.durationHours} x${i}`)
      .join(' + ');
    problem += `  c${constraintCount++}: ${terms} >= ${pref.needMinHours}\n`;
  }

  // Constraint 3: Maximin fairness — z <= satisfaction ratio for each person
  for (const person of request.persons) {
    const totalPrefHours = request.partnerPreferences
      .filter(p => p.personId === person.personId && p.prefIdealHours > 0)
      .reduce((sum, p) => sum + p.prefIdealHours, 0);

    if (totalPrefHours <= 0) continue;

    const relevant = candidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.participantIds.includes(person.personId));

    if (relevant.length === 0) continue;

    const terms = relevant
      .map(({ c, i }) => `${c.durationHours} x${i}`)
      .join(' + ');
    problem += `  c${constraintCount++}: ${terms} - ${totalPrefHours} z >= 0\n`;
  }

  // Variable bounds and types
  problem += 'Bounds\n  0 <= z <= 1\n';
  problem += 'Binary\n';
  for (let i = 0; i < numCandidates; i++) {
    problem += `  x${i}\n`;
  }
  problem += 'End\n';

  // Solve
  const solution = highs.solve(problem);
  const solverTimeMs = Math.round(performance.now() - startTime);

  if (solution.Status !== 'Optimal') {
    return {
      proposedBlocks: [],
      satisfactionScores: emptyScores(request),
      infeasibilityNotes: [
        'Could not find a feasible schedule. ' +
        'Some needs may exceed available overlapping free time.',
      ],
      solverTimeMs,
    };
  }

  // Extract selected candidates
  const proposedBlocks: ProposedBlock[] = [];
  for (let i = 0; i < numCandidates; i++) {
    const varName = `x${i}`;
    const value = solution.Columns[varName]?.Primal ?? 0;

    if (value > 0.5) {
      const cand = candidates[i];
      const blockStart = new Date(
        request.horizonStart.getTime() + cand.startSlot * slotMinutes * 60 * 1000
      );
      const blockEnd = new Date(
        request.horizonStart.getTime() + cand.endSlot * slotMinutes * 60 * 1000
      );

      proposedBlocks.push({
        eventType: cand.eventType,
        start: blockStart,
        end: blockEnd,
        participantIds: cand.participantIds,
        partnershipId: cand.partnershipId,
        podId: cand.podId,
        satisfactionContribution: Object.fromEntries(
          cand.participantIds.map(pid => [pid, cand.durationHours])
        ),
      });
    }
  }

  return {
    proposedBlocks,
    satisfactionScores: computeSatisfaction(proposedBlocks, request),
    infeasibilityNotes: [],
    solverTimeMs,
  };
}
```

If WASM HiGHS works reliably at the problem sizes we need (and early testing should confirm this in Phase 0), then the Python optimizer service is eliminated entirely. The solver becomes a function within the API, called directly — no HTTP hop, no separate deployment, no cold start.

> **Update Required → Technical Architecture § 1.1, § 7 (entire section)**
> If WASM approach works: remove the optimizer as a separate service from the architecture diagram. The solver becomes `apps/api/src/services/optimizer/solver.ts`. Section 7 (Optimization Engine) retains the same algorithms but the code samples become TypeScript. The FastAPI service (§ 7.4) is eliminated.

> **Update Required → Implementation Plan P4 (entire phase)**
> P4.1–P4.5 become TypeScript tasks instead of Python. P4.5 (FastAPI service) is eliminated. The effort estimate drops by about 2 days since there's no inter-service HTTP layer to build.

> **Update Required → Repository Structure § 3**
> `apps/optimizer/` is removed. `apps/api/src/services/optimizer/` contains the solver. `pyproject.toml`, Python Dockerfile, and all Python tooling are eliminated from the project.

#### Fallback: Railway for Python Optimizer

If WASM HiGHS doesn't meet performance requirements or has bugs with the MILP features we need, fall back to the Python optimizer running on Railway.

```
Railway Project:
  Service: pod-life-optimizer
  Source: apps/optimizer/Dockerfile
  Plan: Pro ($5/month, includes sleep-to-zero)
  Region: US West (closest to Neon and Vercel defaults)
  Health check: /health
  Sleep: After 10 minutes of inactivity
```

The API on Vercel calls the Railway optimizer via HTTP, same as the original architecture. Cold start from sleep is 3–5 seconds (Docker container boot + Python init + HiGHS load), which is acceptable since the optimizer only runs during scheduled cycles, not on user-facing requests.

> **Update Required → Technical Architecture § 2.1**
> Add Railway as the optimizer host. Update the system requirements table.

> **Update Required → CLAUDE.md → Development Environment**
> Add note: optimizer can run locally in Python for development regardless of production deployment target.

### 4. Database — Neon PostgreSQL

Neon is purpose-built for this use case: serverless PostgreSQL that scales to zero, with connection pooling that handles the bursty connection patterns of serverless functions.

```
Neon Project: pod-life
Region: US East (aws-us-east-1) or US West (aws-us-west-2)
Compute: Autoscaling (0.25–2 CU on free, up to 8 CU on Launch)
Storage: Free tier includes 0.5 GB, Launch tier includes 10 GB
```

**Connection pooling is critical.** Serverless functions spin up and down constantly, each opening a new database connection. Without pooling, this exhausts PostgreSQL's connection limit within minutes. Neon provides built-in connection pooling via their proxy.

```typescript
// apps/api/src/db/index.ts

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Neon serverless driver — uses HTTP, no persistent connection needed
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

Note the driver change: instead of the standard `pg` driver with a persistent TCP connection, we use `@neondatabase/serverless` which communicates over HTTP. This is designed for serverless environments where connections are short-lived.

> **Update Required → Technical Architecture § 2.1**
> Change PostgreSQL entry from "PostgreSQL 16 self-hosted" to "Neon PostgreSQL (serverless)". Add `@neondatabase/serverless` as the driver. Note: Drizzle ORM works identically — only the driver initialization changes.

> **Update Required → Technical Architecture § 4.2**
> Schema is identical. Add note about Neon branching: Neon supports database branches, which means you can create preview environments per PR with a full database copy. This is extremely useful for testing migrations.

> **Update Required → Implementation Plan P1.1**
> P1.1.1: Change from "Install and configure Drizzle ORM with PostgreSQL driver" to "Install and configure Drizzle ORM with Neon serverless driver (`@neondatabase/serverless`)."

> **Update Required → Implementation Plan P0.2**
> Docker Compose becomes development-only. Add Neon CLI (`neonctl`) for managing dev branches. Local dev can use either Docker PostgreSQL or a Neon dev branch.

**Row-Level Security:** RLS works on Neon exactly as designed in § 4.3. The `SET LOCAL app.current_person_id` command works per-transaction with the Neon serverless driver. No changes needed.

### 5. Cache & Sessions — Upstash Redis

Upstash provides serverless Redis with a REST API and an `@upstash/redis` SDK that works in serverless environments (no persistent TCP connection required).

```typescript
// apps/api/src/lib/redis.ts

import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Usage is identical to ioredis for basic operations
await redis.set('key', 'value', { ex: 3600 });
const value = await redis.get('key');
```

Upstash Redis supports all the Redis commands used in the architecture: GET, SET, SETEX, DEL, key pattern scanning. The only difference is the REST-based transport instead of TCP.

> **Update Required → Technical Architecture § 2.1**
> Change Redis entry from "Redis 7 self-hosted" to "Upstash Redis (serverless)". Change driver from `ioredis` to `@upstash/redis`.

> **Update Required → Technical Architecture § 6.3**
> The free/busy cache logic stays the same. Update the import from `ioredis` to `@upstash/redis`. The `setex` call syntax changes slightly.

> **Update Required → CLAUDE.md → Common Gotchas**
> Add: "Upstash Redis uses REST transport, not TCP. The `@upstash/redis` SDK handles this transparently for basic operations, but Pub/Sub works differently (see real-time section below)."

### 6. Job Scheduling — QStash + Vercel Cron

BullMQ requires a persistent Redis connection and a long-running worker process — both incompatible with serverless. Replace with:

**Vercel Cron** for scheduled triggers (weekly cycle checks):

```json
// vercel.json (add to existing)

{
  "crons": [
    {
      "path": "/api/cron/weekly-cycle",
      "schedule": "0 20 * * 0"
    },
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 3 * * *"
    }
  ]
}
```

```typescript
// apps/api/src/modules/cron/weekly-cycle.ts

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (not an external caller)
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Check which pods are due for a cycle
  const duePods = await findPodsDueForCycle();

  for (const pod of duePods) {
    // Trigger each cycle via QStash (async, with retry)
    await qstash.publishJSON({
      url: `${process.env.APP_URL}/api/internal/run-cycle`,
      body: { podId: pod.id },
      retries: 3,
      delay: 0,
    });
  }

  return new Response('OK');
}
```

**Upstash QStash** for durable async jobs (cycle execution, delayed lock-in):

```typescript
// apps/api/src/lib/queue.ts

import { Client } from '@upstash/qstash';

export const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
});

// Trigger an optimization cycle (processed asynchronously)
export async function enqueueCycle(cycleId: string, personIds: string[]) {
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/internal/process-cycle`,
    body: { cycleId, personIds },
    retries: 3,
  });
}

// Schedule auto-lock after review window
export async function scheduleAutoLock(cycleId: string, delaySeconds: number) {
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/internal/auto-lock`,
    body: { cycleId },
    delay: delaySeconds,
    retries: 2,
  });
}
```

```typescript
// apps/api/src/modules/internal/process-cycle.ts

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';

// This endpoint is called by QStash, not by users
async function handler(request: Request) {
  const { cycleId, personIds } = await request.json();

  // 1. COLLECT: pull free/busy for all persons
  const personSpecs = await collectAvailability(personIds);

  // 2. OPTIMIZE: call solver (either WASM inline or Railway HTTP)
  const result = await solve(buildOptimizationRequest(personSpecs));

  // 3. STORE: write proposed blocks to Neon
  await storeProposals(cycleId, result);

  // 4. NOTIFY: send proposal notifications
  await sendProposalNotifications(cycleId, personIds);

  // 5. SCHEDULE LOCK: auto-lock after review window
  const reviewHours = await getReviewWindowHours(cycleId);
  await scheduleAutoLock(cycleId, reviewHours * 3600);

  return new Response('OK');
}

// QStash signature verification ensures only QStash can call this endpoint
export const POST = verifySignatureAppRouter(handler);
```

QStash handles exactly what BullMQ did — durable job delivery with retries, delayed execution, and guaranteed at-least-once delivery — but without requiring a persistent worker process.

> **Update Required → Technical Architecture § 9.3 (Background Job Definitions)**
> Replace entire section. Remove BullMQ references. Replace with Vercel Cron for scheduled triggers and QStash for async job execution. Update code samples.

> **Update Required → Implementation Plan P5.2**
> Rename from "BullMQ Job Infrastructure" to "QStash Job Infrastructure". Sub-tasks change:
> - P5.2.1: Set up QStash client and internal webhook routes (replaces BullMQ queue setup)
> - P5.2.2: Set up Vercel Cron for weekly cycle check and cleanup (replaces BullMQ cron queue)
> - P5.2.3: Implement QStash signature verification on all internal endpoints (replaces retry logic — QStash handles retries natively)
> - P5.2.4: Implement failure handling via QStash dead letter queue
> - P5.2.5: Remove — BullMQ dashboard not needed; QStash has its own dashboard in Upstash console
> - P5.2.6: Stays the same conceptually but implemented as a Vercel Cron → QStash publish chain

> **Update Required → CLAUDE.md → Technology Decisions table**
> Replace "BullMQ, not polling" with "QStash + Vercel Cron, not BullMQ". Rationale: "Serverless-native job scheduling. No persistent worker process needed. Built-in retries, delay, and dead letter queues."

### 7. Real-Time Updates

Server-Sent Events (SSE) don't work in standard Vercel Functions because they require a persistent connection. Three options:

**Option A — Vercel AI SDK streaming (recommended).** Vercel supports streaming responses, which can be used for SSE-like push. Limited to the duration of a single function invocation (60s on Pro), so not truly persistent, but sufficient for short-lived real-time updates like "your proposal was just accepted."

**Option B — Polling.** The frontend polls `/api/schedule/proposals` every 30 seconds when the proposal review screen is open. Simple, works everywhere, negligible cost at this scale.

**Option C — Upstash Realtime (if available).** Upstash has been building real-time primitives. If they offer a serverless pub/sub by the time Pod Life ships, this would be ideal.

Recommendation: start with polling (Option B). Real-time push is a nice-to-have for a weekly scheduling tool — users aren't staring at the screen waiting for sub-second updates.

> **Update Required → Technical Architecture § 9.2 (Server-Sent Events)**
> Replace SSE implementation with polling. Add a `GET /api/schedule/proposals/poll` endpoint that returns current proposals with an ETag for efficient conditional requests. Frontend polls every 30 seconds when the review screen is active.

> **Update Required → Technical Architecture § 9.1 (Event Bus)**
> Remove Redis Pub/Sub event bus. Events are still published internally (for triggering notifications within a single function invocation) but don't need cross-process pub/sub in serverless.

### 8. Telegram Webhook

Telegram bots in serverless environments use webhooks (Telegram pushes updates to your URL) rather than polling (your server pulls updates from Telegram). grammy supports this natively.

```typescript
// apps/api/src/modules/telegram/telegram.webhook.ts

import { webhookCallback } from 'grammy/web';
import { bot } from './telegram.bot';

// Set webhook URL on deploy
// Run once: bot.api.setWebhook('https://api.podlife.app/telegram/webhook')

export const POST = webhookCallback(bot, 'std/http');
```

This is already the approach implied in the architecture doc (§ 10.1 references a webhook handler), so the bot code itself doesn't change. The only difference is that `bot.start()` (long-polling mode) is never called — the bot only responds to incoming webhooks.

> **Update Required → Technical Architecture § 10.1**
> Add explicit note that the bot runs in webhook mode only, not polling mode. Add the `webhookCallback` setup. Add the one-time `setWebhook` call to the deployment checklist.

### 9. Email — Resend

For magic link emails, Resend is the serverless-friendly choice. No SMTP connection to manage, just an HTTP API call.

```typescript
// apps/api/src/services/email.ts

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, html }: EmailParams) {
  await resend.emails.send({
    from: 'Pod Life <hello@podlife.app>',
    to,
    subject,
    html,
  });
}
```

> **Update Required → Technical Architecture § 5.1**
> Replace SMTP transport with Resend SDK. Update environment variables: remove `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`; add `RESEND_API_KEY`.

> **Update Required → CLAUDE.md → Environment Variables**
> Replace SMTP variables with `RESEND_API_KEY`.

---

## Environment Variables (Serverless)

Replaces § 14.2 of the Technical Architecture.

```bash
# ─── Neon Database ──────────────────────────────────────
DATABASE_URL=              # Neon connection string (with pooling)
                           # Format: postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/podlife?sslmode=require

# ─── Upstash Redis ─────────────────────────────────────
UPSTASH_REDIS_REST_URL=    # Upstash Redis REST endpoint
UPSTASH_REDIS_REST_TOKEN=  # Upstash Redis auth token

# ─── Upstash QStash ────────────────────────────────────
QSTASH_TOKEN=              # QStash publishing token
QSTASH_CURRENT_SIGNING_KEY=   # For webhook signature verification
QSTASH_NEXT_SIGNING_KEY=

# ─── Encryption ────────────────────────────────────────
ENCRYPTION_KEY=            # 32-byte hex (openssl rand -hex 32)

# ─── URLs ──────────────────────────────────────────────
APP_URL=                   # https://api.podlife.app (API functions URL)
FRONTEND_URL=              # https://podlife.app

# ─── Vercel Cron ───────────────────────────────────────
CRON_SECRET=               # Shared secret for cron endpoint auth

# ─── Google OAuth ──────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ─── Email ─────────────────────────────────────────────
RESEND_API_KEY=

# ─── Optional ──────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
ANTHROPIC_API_KEY=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=
OPTIMIZER_URL=             # Only needed if using Railway fallback
```

---

## CI/CD Pipeline

Vercel handles deployment automatically on push to `main`. The pipeline simplifies dramatically compared to the VPS approach.

```yaml
# .github/workflows/ci.yml

name: CI

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: podlife_test
          POSTGRES_USER: podlife
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: pnpm/action-setup@v4

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Lint & Typecheck
        run: |
          pnpm turbo lint
          pnpm turbo typecheck

      - name: Test
        run: pnpm turbo test
        env:
          DATABASE_URL: postgresql://podlife:test@localhost:5432/podlife_test
          ENCRYPTION_KEY: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Deployment flow:

```
PR opened
  → GitHub Actions runs lint, typecheck, tests
  → Vercel creates preview deployment (with Neon branch database)
  → PR review

PR merged to main
  → Vercel auto-deploys to production
  → Neon migration runs (via deploy hook or manual)
  → Zero-downtime (Vercel's atomic deployments)
```

Neon's **database branching** integrates with this beautifully: each PR preview deployment can get its own database branch with a copy of production data, so you can test migrations safely. Neon has a Vercel integration that automates this.

> **Update Required → Implementation Plan P0.3**
> Simplify CI pipeline. Remove Docker build verification (no Docker in production). Remove PostgreSQL/Redis service containers if all tests can use Neon dev branches. Add Vercel preview deployment verification.

> **Update Required → Implementation Plan P10.4**
> Replace entirely. No VPS provisioning, no Cloudflare Tunnel setup, no Docker Compose deployment. Instead: connect GitHub repo to Vercel, configure env vars, set up Neon database, configure Upstash Redis and QStash. Total setup time: ~1 hour instead of half a day.

---

## Monitoring & Observability

### Built-in (no extra cost)

| What | Where |
|------|-------|
| Function invocation logs | Vercel Dashboard → Logs |
| Function duration and errors | Vercel Dashboard → Analytics |
| Database query performance | Neon Dashboard → Monitoring |
| Redis operations | Upstash Dashboard → Analytics |
| QStash job status and failures | Upstash Dashboard → QStash |

### Recommended additions

**Sentry** (free tier: 5k errors/month) for error tracking with stack traces. Sentry has a Vercel integration that auto-instruments functions.

```typescript
// apps/api/src/lib/sentry.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1, // 10% of requests get performance traces
});
```

**Checkly** or **UptimeRobot** (free tier) for uptime monitoring — ping the `/health` endpoint every 5 minutes.

> **Update Required → Implementation Plan P10.4**
> Add sub-task: set up Sentry and uptime monitoring.

---

## Backup & Disaster Recovery

**Database (Neon):** Neon provides automatic point-in-time recovery on all plans. The free tier retains 7 days of history. The Launch tier ($19/month) retains 30 days. No manual backup configuration needed.

**Redis (Upstash):** Upstash Redis is ephemeral cache. Session data and free/busy caches are reconstructable. No backup needed.

**Encryption key:** The `ENCRYPTION_KEY` is the single most critical secret. If lost, all stored calendar OAuth tokens become unrecoverable. Store it in Vercel's encrypted environment variables AND in a separate password manager. Document the recovery process: if the key is lost, all users must re-authenticate their calendars, but no other data is affected.

**Vercel:** Deployments are immutable and retained indefinitely. You can roll back to any previous deployment instantly from the Vercel dashboard.

> **Update Required → CLAUDE.md → Common Gotchas**
> Add: "Neon handles backups automatically. Don't build backup infrastructure. DO ensure the ENCRYPTION_KEY is stored in at least two places."

---

## Self-Hosting (Docker Compose)

The Docker Compose setup from the original architecture becomes the **self-hosting guide**, not the reference deployment. It still works identically for people who want to run their own instance on their own hardware.

```
Self-hosters get:
  - docker-compose.yml (PostgreSQL, Redis, API, Optimizer, Web)
  - .env.example
  - SELF_HOSTING.md with step-by-step guide

The reference deployment uses:
  - Vercel + Neon + Upstash (this document)
```

Both deployment targets use identical application code. The only differences are:

| Concern | Self-Hosted (Docker) | Reference (Serverless) |
|---------|---------------------|----------------------|
| Database driver | `pg` (TCP) | `@neondatabase/serverless` (HTTP) |
| Redis driver | `ioredis` (TCP) | `@upstash/redis` (HTTP) |
| Job queue | BullMQ | QStash + Vercel Cron |
| Entry point | `src/index.ts` (standalone server) | `src/vercel.ts` (function handler) |
| Optimizer | Python FastAPI (Docker container) | WASM in Vercel Function or Railway |

To keep both targets working from the same codebase, use a thin adapter layer:

```typescript
// apps/api/src/lib/db.ts

import * as schema from '../db/schema';

export const db = process.env.NEON_DATABASE_URL
  ? (() => {
      // Serverless: Neon HTTP driver
      const { neon } = require('@neondatabase/serverless');
      const { drizzle } = require('drizzle-orm/neon-http');
      return drizzle(neon(process.env.NEON_DATABASE_URL), { schema });
    })()
  : (() => {
      // Self-hosted: standard pg driver
      const { Pool } = require('pg');
      const { drizzle } = require('drizzle-orm/node-postgres');
      return drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema });
    })();
```

```typescript
// apps/api/src/lib/redis.ts

export const redis = process.env.UPSTASH_REDIS_REST_URL
  ? (() => {
      const { Redis } = require('@upstash/redis');
      return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    })()
  : (() => {
      const { Redis } = require('ioredis');
      return new Redis(process.env.REDIS_URL);
    })();
```

> **Update Required → Technical Architecture § 2.1**
> Add dual-driver pattern. Note that both deployment targets are first-class and tested in CI.

> **Update Required → Implementation Plan P1.1.1**
> Install both `@neondatabase/serverless` and `pg` drivers. Implement the adapter layer so both work.

> **Update Required → CLAUDE.md → Key Technical Decisions**
> Add row: "Dual-driver adapters for DB and Redis | Supports both serverless (Vercel/Neon/Upstash) and self-hosted (Docker/PostgreSQL/Redis) from the same codebase | Don't build for only one deployment target"

---

## Cost Projections

### Phase 1: Development & Beta (0–20 users)

Everything on free tiers.

| Service | Plan | Monthly |
|---------|------|---------|
| Vercel | Hobby | $0 |
| Neon | Free (0.5 GB, 1 branch) | $0 |
| Upstash Redis | Free (10k commands/day) | $0 |
| Upstash QStash | Free (500 messages/day) | $0 |
| Resend | Free (100 emails/day) | $0 |
| **Total** | | **$0** |

### Phase 2: Early Adoption (20–200 users)

Vercel Pro for 60-second function duration. Neon Launch for more storage and compute.

| Service | Plan | Monthly |
|---------|------|---------|
| Vercel | Pro | $20 |
| Neon | Launch | $19 |
| Upstash Redis | Pay-as-you-go | $0–3 |
| Upstash QStash | Pay-as-you-go | $0–1 |
| Resend | Pro | $20 |
| **Total** | | **$59–63** |

### Phase 3: Growth (200–1000 users)

| Service | Plan | Monthly |
|---------|------|---------|
| Vercel | Pro | $20 |
| Neon | Scale | $69 |
| Upstash Redis | Pro | $10 |
| Upstash QStash | Pro | $10 |
| Resend | Pro | $20 |
| Sentry | Team | $26 |
| **Total** | | **~$155** |

At 1,000 users paying even $3/month, that's $3,000/month revenue against $155/month infrastructure. The unit economics are strong.

---

## Validation Steps Before Committing to This Architecture

Before updating all project documents, validate these assumptions:

### V1: WASM HiGHS works in Vercel Functions

```bash
# Quick test: install highs-solver, solve a small MILP, verify correctness
npm install highs-solver
node -e "
  const Highs = require('highs-solver');
  (async () => {
    const highs = await Highs();
    const result = highs.solve('Maximize\n  obj: x\nSubject To\n  c1: x <= 10\nBounds\n  0 <= x\nEnd');
    console.log(result.ObjectiveValue);  // should be 10
  })();
"
```

Then test with a realistic problem size (300+ binary variables). If it solves in under 5 seconds, we're good. If it's too slow or crashes, fall back to Railway Python.

> **Update Required → Implementation Plan P0.2**
> Add sub-task P0.2.0: "Validate WASM HiGHS solver in a Vercel Function environment. Test with the `oversubscribed` fixture (10 people, 7-day horizon, ~3000 binary variables). If solve time exceeds 10 seconds or WASM fails, proceed with Railway Python fallback."

### V2: Neon connection pooling handles burst load

The scheduling cycle triggers multiple concurrent database writes (one per proposed time block). Verify Neon's connection pooler handles this without connection exhaustion.

### V3: QStash webhook delivery is reliable

Test that QStash reliably delivers to Vercel Function URLs with the expected latency (should be <1 second). Verify retry behavior on function timeouts.

---

## Complete Change Manifest

Summary of every section across all project documents that needs updating.

### Technical Architecture Document

| Section | Change Type | Description |
|---------|------------|-------------|
| § 1.1 System Overview | **Rewrite** | New architecture diagram (serverless). Remove separate optimizer service (if WASM works). |
| § 2.1 Stack Decisions | **Update** | PostgreSQL → Neon, Redis → Upstash, BullMQ → QStash, add Vercel, add Resend. |
| § 2.2 System Requirements | **Rewrite** | Remove VPS specs. Document Vercel/Neon/Upstash tier requirements per user count. |
| § 5.1 Auth Flow | **Update** | Replace SMTP email transport with Resend SDK. |
| § 6.3 Free/Busy Aggregator | **Update** | Change Redis imports from `ioredis` to `@upstash/redis`. Adjust cache calls. |
| § 7 Optimization Engine | **Conditional rewrite** | If WASM: rewrite as TypeScript. If Railway: update deployment target only. |
| § 7.4 FastAPI Service | **Remove or update** | Remove if WASM. Update deployment reference if Railway. |
| § 8.1 API Application Setup | **Update** | Add Vercel adapter entry point alongside standalone server. |
| § 9.1 Event Bus | **Simplify** | Remove Redis Pub/Sub. Events are function-local. |
| § 9.2 SSE | **Replace** | Replace with polling endpoint. |
| § 9.3 Background Jobs | **Rewrite** | BullMQ → QStash + Vercel Cron with full code samples. |
| § 14.1 Docker Compose | **Relabel** | Mark as "development and self-hosting only". |
| § 14.2 Environment Config | **Rewrite** | New env var set for serverless services. |

### Implementation Plan

| Task | Change Type | Description |
|------|------------|-------------|
| P0.2 | **Update** | Docker Compose is dev-only. Add WASM validation sub-task. |
| P0.3 | **Simplify** | Remove Docker build CI step. Vercel handles deployment. |
| P1.1.1 | **Update** | Dual-driver setup (Neon serverless + standard pg). |
| P4 (all) | **Conditional rewrite** | If WASM: tasks become TypeScript, remove FastAPI. If Railway: minor changes only. |
| P5.2 | **Rewrite** | BullMQ → QStash. New sub-task structure. |
| P10.3 | **Update** | Self-hosting guide uses Docker Compose. Reference deployment uses Vercel. |
| P10.4 | **Rewrite** | Vercel setup replaces VPS provisioning. |

### CLAUDE.md

| Section | Change Type | Description |
|---------|------------|-------------|
| Architecture at a Glance | **Update** | Add serverless deployment as primary, Docker as dev/self-host. |
| Development Environment | **Update** | Add Neon CLI, note dual-driver pattern. |
| Technology Decisions table | **Update** | BullMQ → QStash row. Add Neon and Upstash rows. |
| Environment Variables | **Rewrite** | New variable set per this document. |
| Common Gotchas | **Add** | Neon connection pooling, QStash signature verification, Vercel function duration limits. |

### PRD

| Section | Change Type | Description |
|---------|------------|-------------|
| § 1 Open Source Strategy | **Update** | Note dual deployment targets: serverless reference + Docker self-hosting. |

---

*Pod Life is a project by Benjamin Life (@omniharmonic). Built with love, for love.*
