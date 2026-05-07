# Deploying Pod Life to Fly.io

This is an example recipe. Pod Life is platform-agnostic.

> **This document is not a tested deployment.** It's a starting recipe.
> Verify each step against current Fly.io docs and your own setup.

## Prerequisites

- A Fly.io account.
- `flyctl` installed: `brew install flyctl` or follow https://fly.io/docs/hands-on/install-flyctl/.
- `flyctl auth login`.
- Your `ENCRYPTION_KEY` (from `openssl rand -hex 32`) safely stored.

## Architecture on Fly.io

- One **Fly Postgres cluster** (managed).
- One **Upstash Redis** (via the Fly extension marketplace).
- Three Fly apps: `pod-life-api`, `pod-life-optimizer`, `pod-life-web`.

## Step 1 — Create the Postgres cluster

```bash
fly postgres create --name pod-life-db --region <your region>
```

Note the connection string (`fly postgres connect -a pod-life-db` if needed).

## Step 2 — Create Redis

```bash
fly extensions create upstash-redis --name pod-life-redis
```

## Step 3 — Deploy the optimizer

```bash
cd apps/optimizer
fly launch --name pod-life-optimizer --no-deploy --copy-config
# edit fly.toml: set internal_port = 8000, primary_region, no public services
fly deploy
```

The optimizer should be reachable only on Fly's private 6PN network at
`pod-life-optimizer.internal:8000`.

## Step 4 — Deploy the API

```bash
cd apps/api
fly launch --name pod-life-api --no-deploy --copy-config
fly secrets set \
  DATABASE_URL="postgres://..." \
  REDIS_URL="redis://..." \
  OPTIMIZER_URL="http://pod-life-optimizer.internal:8000" \
  ENCRYPTION_KEY="<your hex>" \
  APP_URL="https://pod-life-api.fly.dev" \
  FRONTEND_URL="https://pod-life-web.fly.dev" \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  SMTP_HOST="..." \
  SMTP_USER="..." \
  SMTP_PASS="..." \
  EMAIL_FROM="hello@podlife.example.com" \
  NODE_ENV=production
fly deploy
```

## Step 5 — Run migrations

```bash
fly ssh console -a pod-life-api -C "pnpm db:migrate"
fly ssh console -a pod-life-api -C "pnpm db:seed"
```

## Step 6 — Deploy the web app

```bash
cd apps/web
fly launch --name pod-life-web --copy-config
fly secrets set VITE_API_URL="https://pod-life-api.fly.dev"
fly deploy
```

## Custom domain

```bash
fly certs add podlife.example.com -a pod-life-web
fly certs add api.podlife.example.com -a pod-life-api
```

Update `APP_URL` and `FRONTEND_URL` to match. Update Google OAuth redirect URIs.

## Telegram webhook (optional)

```bash
fly secrets set TELEGRAM_BOT_TOKEN="..." TELEGRAM_WEBHOOK_SECRET="..." \
  TELEGRAM_WEBHOOK_URL="https://api.podlife.example.com/telegram/webhook/<secret>" \
  -a pod-life-api
fly ssh console -a pod-life-api -C "pnpm telegram:set-webhook"
```

## Backups

Fly Postgres clusters include daily snapshots. Verify retention. Back up your
`ENCRYPTION_KEY` separately — losing the key means losing every stored OAuth
token.

## Scaling

```bash
fly scale count 2 -a pod-life-api          # horizontal
fly scale memory 1024 -a pod-life-api      # vertical
fly scale memory 2048 -a pod-life-optimizer # optimizer is the memory-hungry one
```

The optimizer benefits from more RAM under load (HiGHS keeps the model in
memory). Two replicas of the API are usually enough for a family-scale
deployment.
