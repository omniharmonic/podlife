# Self-Hosting Pod Life

This guide walks you through hosting your own Pod Life instance — for your
family, your community, or just to keep your data on your own infrastructure.

Pod Life is **AGPL-3.0**. If you run a hosted service derived from this code,
you must offer the modified source under the same license.

---

## Prerequisites

- A Linux host (Ubuntu 22.04+, Debian 12+, or similar). 2 GB RAM minimum, 4 GB
  recommended for the optimizer.
- Docker 24+ and Docker Compose v2.
- pnpm 10+ and Node.js 22+ (only if you're building from source rather than
  using prebuilt images).
- OpenSSL.
- A domain name with DNS pointed at your host (for HTTPS).
- An SMTP server for sending magic links (or a transactional email provider
  like Resend, Postmark, or SendGrid).

---

## Step 1 — Clone and configure

```bash
git clone https://github.com/omniharmonic/pod-life.git
cd pod-life
cp .env.example .env
```

### Generate the encryption key

This key encrypts every stored OAuth token. **If you lose it, every user must
re-authenticate every calendar.** Back it up separately from your database.

```bash
openssl rand -hex 32
```

Paste the output as `ENCRYPTION_KEY` in your `.env`.

### Set the URLs

```env
APP_URL=https://podlife.example.com
FRONTEND_URL=https://podlife.example.com
```

If you serve the API and the web UI from different domains, set them to
different values.

### Set a strong database password

```env
DB_PASSWORD=<long random string from `openssl rand -base64 32`>
DATABASE_URL=postgresql://podlife:<that password>@postgres:5432/podlife
```

---

## Step 2 — Start the stack

For a full self-hosted deployment, use the production compose file:

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts:

- `postgres` (PostgreSQL 16, on internal network only)
- `redis` (Redis 7, on internal network only)
- `optimizer` (Python MILP solver, internal only)
- `api` (Hono REST API, port 3000)
- `web` (static React PWA, port 5173)

For local dev, use `docker compose up -d postgres redis` and run the apps with
`pnpm dev`.

### Run database migrations

```bash
docker compose -f docker-compose.prod.yml exec api pnpm db:migrate
docker compose -f docker-compose.prod.yml exec api pnpm db:seed
```

The seed script populates the default event types (Date Night, Quality Time,
Pod Time, Solo Time, etc.).

### Reverse proxy

Put HTTPS in front using Caddy, nginx, or Traefik. A minimal Caddyfile:

```caddy
podlife.example.com {
  handle /api/* {
    reverse_proxy localhost:3000
  }
  handle /telegram/* {
    reverse_proxy localhost:3000
  }
  handle /auth/* {
    reverse_proxy localhost:3000
  }
  handle {
    reverse_proxy localhost:5173
  }
}
```

---

## Step 3 — External account setup

All of these are optional. The app works with whatever you configure; missing
integrations degrade gracefully.

### Google Calendar OAuth

1. Go to https://console.cloud.google.com/, create a project.
2. Enable the **Google Calendar API**.
3. Go to **Credentials → Create credentials → OAuth client ID**.
4. Application type: **Web application**.
5. Authorized redirect URIs:
   `https://podlife.example.com/auth/google/callback`
6. Copy the client ID and secret into `.env`:
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
7. On the **OAuth consent screen**, add the scopes:
   `.../auth/calendar.freebusy` and `.../auth/calendar.events`. Request
   verification once you have real users.

### Microsoft (Outlook) OAuth — optional

1. Go to https://portal.azure.com/ → **Azure Active Directory** → **App
   registrations**.
2. New registration. Redirect URI:
   `https://podlife.example.com/auth/microsoft/callback`.
3. Under **API permissions**, add `Calendars.Read` and `Calendars.ReadWrite`
   delegated permissions.
4. Under **Certificates & secrets**, create a client secret.
5. Copy `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and `MS_TENANT_ID=common` into
   `.env`.

### Apple iCloud / CalDAV — optional

iCloud requires app-specific passwords (not OAuth). The flow is:

1. Users go to https://appleid.apple.com/, sign in, and generate an
   app-specific password under **Sign-in and security**.
2. They paste that password into Pod Life's calendar connection page.
3. Pod Life encrypts and stores it like any other credential.

iCloud's CalDAV is finicky. If you have only iCloud users, manual availability
entry may be more reliable.

### Telegram Bot — optional

1. Open Telegram, message **@BotFather**, send `/newbot`.
2. Follow the prompts. Save the bot token.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (without the `@`) in
   `.env`.
4. Generate a webhook secret: `openssl rand -hex 32`. Set
   `TELEGRAM_WEBHOOK_SECRET`.
5. Set `TELEGRAM_WEBHOOK_URL=https://podlife.example.com/telegram/webhook/<that secret>`.
6. Run the one-shot webhook setup:
   ```bash
   docker compose -f docker-compose.prod.yml exec api pnpm telegram:set-webhook
   ```

If you skip this entire section, the bot subsystem is fully disabled — no
commands, no DMs, no group notifications.

### Anthropic Claude (AI features) — optional

1. Get an API key from https://console.anthropic.com/.
2. Set `ANTHROPIC_API_KEY` in `.env`.

Without this key, AI-powered preference parsing and conflict explanations are
disabled but the rest of the app works fine.

### SMTP (magic links) — required for production

Pod Life uses magic-link auth, so email delivery matters. Any SMTP-capable
provider works:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=podlife@example.com
SMTP_PASS=<password>
EMAIL_FROM=hello@example.com
```

In development, magic links are also logged to the API console, so you can
develop without SMTP credentials.

---

## Step 4 — Backup and restore

### Postgres backups

```bash
# Daily backup (run from cron)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U podlife -F c podlife > /backups/podlife-$(date +%F).dump
```

### Restore

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U podlife -d podlife -c < /backups/podlife-2026-01-15.dump
```

### Important: back up the encryption key separately

Your database backup is **useless without the encryption key** — every stored
OAuth token will be unreadable. Store the key in a different trust domain
(password manager, secrets vault, sealed envelope).

If you ever need to rotate the key, decrypt all tokens with the old key and
re-encrypt with the new one before swapping it. There's no in-app rotation
flow yet — coordinate downtime if you need this.

---

## Step 5 — Upgrades

```bash
cd pod-life
git pull origin main
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api pnpm db:migrate
```

Migrations are forward-only and additive. We never remove columns or tables in
the same release that introduces a replacement; you'll always have at least
one release of overlap.

Read [CHANGELOG.md](./CHANGELOG.md) before upgrading. Anything labeled
`BREAKING` will require manual steps.

---

## Troubleshooting

### "ENCRYPTION_KEY not set" on startup

The API refuses to start without `ENCRYPTION_KEY`. Set it in `.env` (32-byte
hex from `openssl rand -hex 32`).

### Magic links never arrive

- Check the API logs (`docker compose logs api`) — in dev, links are printed
  there.
- Verify SMTP credentials are correct.
- Try sending a test email manually to confirm SMTP works.
- Check spam folders.

### Calendar OAuth callback fails with "redirect_uri_mismatch"

The redirect URI registered with Google/Microsoft must **exactly** match the
URL Pod Life redirects to (including trailing slashes and protocol). Check
`APP_URL` in `.env`.

### Optimizer returns "infeasible"

This is **not a bug** — it means the constraints can't be satisfied (e.g.,
two partners each need 10 hours but only share 6 hours of free time). The web
UI should explain which person can't be satisfied. If it crashes instead, file
an issue.

### Privacy mode jitter is creating odd schedule times

That's the point — it makes timing patterns harder to correlate across pods.
If you find it more annoying than useful, disable it in user settings.

### "Database connection refused"

- Is the Postgres container running? `docker compose ps`
- Did you run migrations? `pnpm --filter @pod-life/api db:migrate`
- Is `DATABASE_URL` correct in `.env`?

---

## Going further

- **Multi-tenant deployment:** Pod Life is single-tenant by design. If you
  want to host multiple unrelated families, run separate deployments — the
  privacy model assumes one trust domain per database.
- **Cloud platform recipes:** See [`RAILWAY.md`](./RAILWAY.md) and
  [`FLY.md`](./FLY.md) for example deployments.
- **Monitoring:** Pod Life emits structured JSON logs. Pipe to Loki, Datadog,
  or similar. Metrics are exposed on `/metrics` (Prometheus format).

If something in this guide is wrong, unclear, or outdated, please open a PR.
