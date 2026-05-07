# Contributing to Pod Life

Thank you for considering a contribution. Pod Life is an open-source project
that handles deeply personal information for real people in real relationships.
That sets the bar high — we need contributors who care about correctness,
privacy, and warmth in equal measure.

This guide covers what you need to know to get productive.

---

## Code of conduct

Be kind. Communicate clearly. Respect each other's time. If you wouldn't say it
in a partner check-in, don't put it in a code review.

---

## Development setup

### Prerequisites

- Node.js 22+
- pnpm 10+
- Python 3.12+
- Docker (for local Postgres + Redis)
- OpenSSL (for generating the encryption key)

### One-time setup

```bash
git clone https://github.com/omniharmonic/pod-life.git
cd pod-life
pnpm install
cd apps/optimizer && pip install -r requirements.txt -e ".[dev]" && cd ../..
cp .env.example .env
# Generate ENCRYPTION_KEY:
openssl rand -hex 32
# Paste it into .env
docker compose up -d postgres redis
pnpm --filter @pod-life/api db:migrate
pnpm --filter @pod-life/api db:seed
```

### Running the stack

```bash
pnpm dev                                    # everything (turbo)
pnpm --filter @pod-life/api dev             # API only (port 3000)
pnpm --filter @pod-life/web dev             # web only (port 5173)
cd apps/optimizer && uvicorn src.main:app --reload --port 8000
```

### Running tests

```bash
pnpm test                                   # all TS tests
pnpm --filter @pod-life/api test            # API integration tests
pnpm --filter @pod-life/web test            # web unit tests
cd apps/optimizer && pytest                 # optimizer tests
pnpm typecheck                              # TS typecheck across the monorepo
```

---

## Code style

### TypeScript (api + web + shared)

- **Strict mode everywhere.** No `any` types except at serialization boundaries.
- **Zod for all external input.** API request bodies, query params, and
  environment variables are validated with Zod schemas defined in
  `packages/shared` where shared, or co-located with the route otherwise.
- **Drizzle ORM for database access.** No raw SQL except for RLS policies
  and migrations.
- **No default exports** except for React page components.
- **Import order:** Node builtins → external packages → internal packages →
  relative imports.
- **Error handling:** Use the `AppError` class with error codes. Never expose
  internal error details to the client. Log full errors server-side.

### Python (optimizer)

- **Pydantic v2** for all data models.
- **Type hints** on all function signatures.
- **pytest** for tests; use fixtures for polycule configurations.
- **No database access.** The optimizer is a pure function: problem spec in,
  proposed schedule out.

### Formatting

We use Prettier for TS/JSON/Markdown and ruff/black-equivalent style for
Python. Run `pnpm format` before committing.

---

## Commit conventions

Reference the task ID from the implementation plan in your commit message:

```
feat(P2.1): implement partner invite and accept flow
fix(privacy): scope partnership query to authenticated person's pods
refactor(P3.4): extract free/busy merge into shared helper
docs(SELF_HOSTING): clarify ENCRYPTION_KEY rotation
test(P9.1): cross-pod invisibility for schedule endpoints
```

Branch names follow the same convention:

```
feat/P2.1-partner-invite
fix/privacy-leak-pod-members
refactor/calendar-aggregator
```

---

## Pull request process

1. **One PR per task** (or a small group of related sub-tasks). Don't combine
   unrelated changes.
2. **Open a draft PR early.** It's easier to course-correct on a draft than
   after a full review pass.
3. **Fill in the PR template.** The Definition of Done checklist is there for
   a reason.
4. **CI must pass.** Don't merge with red checks. If the failure looks
   spurious, investigate — flaky tests are bugs.
5. **Privacy-sensitive code requires a privacy review.** If your change touches
   relationship data, schedule data, or any outbound message, an additional
   reviewer with the `privacy` GitHub label must approve.
6. **Squash on merge.** We keep the main branch history linear and readable.

### Definition of Done

A change is complete when:

- The code follows the conventions above.
- Unit tests pass for changed logic.
- Integration tests pass for changed API routes.
- If the change touches privacy-sensitive code, the relevant privacy boundary
  test passes.
- TypeScript has no errors. Python type-checks pass.
- No lint warnings.
- The deliverable described in the implementation plan task is demonstrably
  working (manual test or automated test).
- Commit message references the task ID.

---

## Testing standards

### API routes

Every API route gets an integration test that verifies:

- Correct response for valid input
- Validation error for invalid input
- 401 for unauthenticated access
- 403 for unauthorized access (if applicable)

### Privacy-sensitive endpoints

Additional tests verify cross-pod data isolation. The test pattern:

> Given Person A is in Pod 1 with Person B and in Pod 2 with Person C, when
> Person A calls `GET /partnerships`, the response must not contain any
> evidence linking Person B and Person C, and Person B must never see anything
> related to Person C.

### Optimizer

- Unit tests for each constraint group.
- End-to-end tests for each polycule fixture in
  `apps/optimizer/tests/fixtures/`.
- Don't skip the `multi_pod_conflict` and `oversubscribed` fixtures — they're
  the ones most likely to reveal formulation bugs.

### Frontend

- Tests for user interactions and state changes.
- Don't test visual rendering (that's what design reviews are for).
- Use Testing Library queries that match how users find elements
  (`getByRole`, `getByLabelText`).

---

## Privacy commitments

Pod Life is privacy-first. When working on any feature that touches
relationship or schedule data, ask:

> If Person B called this endpoint / saw this message / received this
> notification, would they learn anything about Person C who is in a different
> pod?

If the answer is anything other than a definitive **no**, there's a privacy
bug. Fix it before merging.

The privacy boundary test suite is mandatory and runs in CI. Don't skip it,
don't comment it out, don't add `.skip()` to "fix later." Fix it now.

---

## Domain vocabulary

Use these terms consistently in code, comments, and UI:

| Term              | Meaning                                                    |
| ----------------- | ---------------------------------------------------------- |
| **Person**        | A user of the system                                       |
| **Partnership**   | A bidirectional romantic relationship between two People   |
| **Pod**           | A named group of People in some relationship configuration |
| **Need**          | A hard minimum constraint                                  |
| **Preference**    | A soft target                                              |
| **Time Block**    | A proposed or confirmed calendar event                     |
| **Scheduling Cycle** | One run of the collect→optimize→propose→lock flow       |
| **Satisfaction**  | How close a person is to their ideal allocation (0-100%)   |
| **Reshuffle**     | Rearranging locked blocks mid-cycle                        |
| **Free Window**   | A contiguous block when a person has no calendar conflicts |
| **Candidate Slot** | A potential time block where required participants are free |

Don't invent synonyms. Consistency matters because the vocabulary leaks into
the UI, where it sets user expectations.

---

## Questions?

- **Product questions:** Check `.claude/pod-life-prd.md`.
- **Technical questions:** Check `.claude/pod-life-technical-architecture.md`.
- **Sequencing questions:** Check `.claude/pod-life-implementation-plan.md`.
- **Anything else:** Open a discussion on GitHub.

Thank you for contributing. ☀️
