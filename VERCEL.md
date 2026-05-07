# Deploying Pod Life to Vercel (serverless reference)

This is the reference deployment: API + web on Vercel, database on Neon,
cache + job queue on Upstash, email on Resend, Python optimizer on Railway.

For self-hosted (Docker / VPS) deployment, see `SELF_HOSTING.md` and `RAILWAY.md`.

---

## Cost summary

| Component | Service | Free tier | Paid tier |
|-----------|---------|-----------|-----------|
| Frontend (PWA) | Vercel | $0 | — |
| API (Hono functions) | Vercel | $0 | $20/mo (Pro, 60s+ funcs) |
| Postgres | Neon | $0 (0.5 GB) | $19/mo (Launch, 10 GB) |
| Redis + QStash | Upstash | $0 (10k cmd/day) | ~$10/mo at scale |
| Email | Resend | $0 (100/day) | $20/mo (Pro) |
| Optimizer | inline WASM (in API function) | $0 | $0 |
| **Total** | | **$0/mo** | **~$70/mo** |

The codebase ships dual-driver adapters; switching any layer is just an env
var change. See `CLAUDE.md` "Two Deployment Targets" for the table.

---

## Pre-deploy checklist

1. **Provision external services first.** You'll need URLs/tokens before deploy.
   - Neon: create a project, copy the **pooled** connection string from the
     Neon dashboard (the one with `-pooler` in the hostname). Branches:
     enable Vercel integration if you want a preview-DB-per-PR.
   - Upstash: create a Redis database (REST API enabled by default), copy
     `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Then create
     a QStash workspace and copy `QSTASH_TOKEN`,
     `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
   - Resend: verify your sending domain, copy `RESEND_API_KEY`.
   - Optimizer: nothing to provision — the API function calls the inline
     WASM HiGHS solver directly. (If you need to fall back to the Python
     reference implementation for some reason, see `RAILWAY.md` "Serverless:
     Optimizer-Only Recipe" and set `OPTIMIZER_HTTP=1` plus `OPTIMIZER_URL`.)
2. **Run migrations.** Against the **direct** (non-pooled) Neon connection
   string, run `pnpm --filter @pod-life/api db:migrate`. RLS policies require
   the direct connection during migration.
3. **Generate secrets.** `openssl rand -hex 32` for both `ENCRYPTION_KEY`
   and `CRON_SECRET`. Store the encryption key in a password manager — if
   it's lost, every user must re-authenticate their calendars.

## Vercel project setup

```bash
# From repo root
vercel link --project pod-life-api --scope <your-team>

# Tell Vercel where the API project's root is (vercel.json lives there)
# In the Vercel dashboard: Settings → General → Root Directory: apps/api
```

Or via dashboard: connect the GitHub repo, set **Root Directory** to
`apps/api/`. Vercel auto-detects `apps/api/vercel.json`.

## Environment variables

Set these on the Vercel project (via dashboard or `vercel env add`):

```bash
# Required
DATABASE_URL                 # Neon pooled connection string
ENCRYPTION_KEY               # 32-byte hex
APP_URL                      # https://api.podlife.example.com
FRONTEND_URL                 # https://podlife.example.com
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# Serverless transports (each one switches a layer to its serverless backend)
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
CRON_SECRET                  # 32-byte hex; Vercel sends as Bearer to /api/cron/*
RESEND_API_KEY

# Optional
TELEGRAM_BOT_TOKEN
ANTHROPIC_API_KEY
MS_CLIENT_ID
MS_CLIENT_SECRET
MS_TENANT_ID
```

After adding env vars on Vercel, pull them locally for testing:

```bash
vercel env pull .env.local
```

## Cron schedule

Already declared in `apps/api/vercel.json`:

- `/api/cron/auto-lock` — every hour (locks expired proposals)
- `/api/cron/weekly-cycle` — Sundays at 20:00 UTC (kicks off the weekly cycle)

Vercel calls these with a `Bearer $CRON_SECRET` header. The handlers verify
and then enqueue real work onto QStash.

## Deploy

```bash
# Preview (PR-style)
vercel deploy

# Production
vercel deploy --prod
```

Or just push to `main` if you've connected the repo via GitHub integration.

## Telegram webhook (optional)

After first deploy, point Telegram at the Vercel URL:

```bash
# Set TELEGRAM_WEBHOOK_URL in Vercel env first, then:
pnpm --filter @pod-life/api telegram:set-webhook
```

The webhook URL must include `TELEGRAM_WEBHOOK_SECRET`, e.g.
`https://api.podlife.example.com/telegram/webhook/<secret>`.

## Verifying the deploy

```bash
curl https://api.podlife.example.com/health
# → {"status":"ok","db":true,"redis":true}
```

If `db: false`, check `DATABASE_URL` and that the Neon pooler hostname is
correct. If `redis: false`, check `UPSTASH_REDIS_REST_URL` and the token.

To test cron locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://api.podlife.example.com/api/cron/auto-lock
```

## What's NOT on Vercel

- The PWA frontend — could be a separate Vercel project pointing at
  `apps/web/`. The frontend is also pure static, so any CDN works.

The Python optimizer at `apps/optimizer/` is no longer deployed by default;
it remains in-tree as the canonical reference implementation for the MILP
formulation, and as a debugging fallback (set `OPTIMIZER_HTTP=1` plus
`OPTIMIZER_URL`).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| 504 timeout on `/api/schedule/cycles` | Cold-start WASM init | Cycle orchestration runs in QStash-pushed `/internal/run-cycle` (60s budget). First solve is ~50ms after Fluid Compute warm-up. If consistently slow, audit `solver_time_ms` in cycle records |
| Schedule cycle returns 0 blocks with infeasibility note | WASM solver crashed on a pathological LP shape | The solver auto-retries with looser tolerance. If still empty, set `OPTIMIZER_HTTP=1` and point `OPTIMIZER_URL` at a Railway-hosted Python optimizer (legacy fallback, see RAILWAY.md) |
| 401 from `/internal/run-cycle` | QStash signing key mismatch | Re-paste both `QSTASH_*_SIGNING_KEY` values from Upstash dashboard |
| `BEGIN/SET LOCAL` errors | Using Neon HTTP driver instead of Pool | Confirm `DATABASE_URL` contains `.neon.tech` (auto-selects WS Pool) |
| Tests fail locally with serverless env vars | Tests run against self-hosted path | Don't set `UPSTASH_*` / `QSTASH_*` in `.env`, only in Vercel |
