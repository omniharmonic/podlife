# Deploying Pod Life to Railway

This is an example recipe. Pod Life is platform-agnostic; Railway is just one
option among many (Fly.io, Render, Hetzner Cloud, your own VPS, etc.).

> **This document is not a tested deployment.** It's a starting recipe.
> Verify each step against current Railway docs and your own setup.

## Two Recipes

This file covers two ways to use Railway:

**A. Full self-hosted** — everything (Postgres, Redis, API, Optimizer, Web) on
   Railway. See "Full Self-Hosted Recipe" below. Total cost ~$25–45/month.

**B. Serverless reference + optimizer-only on Railway** — the API/web/database
   live on Vercel + Neon + Upstash; Railway just hosts the Python optimizer
   container. The Vercel API calls it via `OPTIMIZER_URL`. See
   "Serverless: Optimizer-Only Recipe" below. Total cost ~$5/month for Railway,
   ~$0–20/month for the rest depending on tier.

---

## Serverless: Optimizer-Only Recipe

In this mode you run only the Python optimizer on Railway. The rest of the
stack runs on Vercel (API + web), Neon (Postgres), Upstash (Redis + QStash),
and Resend (email).

```bash
railway login
cd /path/to/pod-life
railway init pod-life-optimizer

# Deploy ONLY the optimizer service from apps/optimizer/Dockerfile
railway up --service optimizer
```

In Railway's service settings:
- **Source**: build from Dockerfile at `apps/optimizer/Dockerfile`
- **Public networking**: enable, expose port 8000
- **Sleep**: enable (sleep-to-zero after 10 min idle to keep costs at $5/mo)
- **Health check**: `GET /health`

Once deployed, copy the public URL (e.g. `https://pod-life-optimizer.up.railway.app`)
and set it on your Vercel project as the `OPTIMIZER_URL` env var.

Cold-start latency from sleep is 3–5 seconds (Docker boot + Python init +
HiGHS load). Acceptable because the optimizer only runs during scheduling
cycles, never on user-facing requests.

---

## Full Self-Hosted Recipe

## Prerequisites

- A Railway account.
- The Railway CLI installed: `brew install railway` or `npm i -g @railway/cli`.
- Your `ENCRYPTION_KEY` (generated with `openssl rand -hex 32`) safely stored.

## Architecture on Railway

You'll create one Railway project with these services:

1. **postgres** — Railway's managed Postgres plugin
2. **redis** — Railway's managed Redis plugin
3. **api** — built from `apps/api/Dockerfile`
4. **optimizer** — built from `apps/optimizer/Dockerfile`
5. **web** — built from `apps/web/Dockerfile`

## Steps

```bash
railway login
railway init pod-life
cd pod-life

# Add managed Postgres + Redis
railway add --plugin postgresql
railway add --plugin redis

# Deploy each service
railway up --service api
railway up --service optimizer
railway up --service web
```

## Environment variables

Set on the **api** service:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
OPTIMIZER_URL=${{optimizer.RAILWAY_PRIVATE_DOMAIN}}:8000
ENCRYPTION_KEY=<your 32-byte hex>
APP_URL=https://api.podlife.example.com
FRONTEND_URL=https://podlife.example.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=hello@podlife.example.com
NODE_ENV=production
```

Set on the **web** service:

```
VITE_API_URL=https://api.podlife.example.com
```

The **optimizer** needs no env vars by default.

## Custom domains

In the Railway dashboard, add custom domains to **api** and **web**. Update
`APP_URL` and `FRONTEND_URL` to match.

Add the OAuth redirect URI to your Google Cloud Console:
`https://api.podlife.example.com/auth/google/callback`.

## First-time migrations

```bash
railway run --service api pnpm db:migrate
railway run --service api pnpm db:seed
```

## Telegram webhook (optional)

```bash
railway run --service api pnpm telegram:set-webhook
```

## Cost estimate (rough)

- Postgres: ~$5-10/month for a small instance
- Redis: ~$5/month
- API: ~$5-15/month depending on traffic
- Optimizer: ~$5-10/month (mostly idle)
- Web: ~$5/month (or free on a CDN)

Total: roughly **$25-45/month** for a self-hosted family-scale deployment.

## Backups

Railway's Postgres plugin includes automated daily backups. Verify retention
matches your needs. Independently back up your `ENCRYPTION_KEY` somewhere
that is not Railway.
