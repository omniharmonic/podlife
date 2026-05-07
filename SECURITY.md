# Security & Privacy Policy

Pod Life handles information about real people's intimate relationships. A
security or privacy bug isn't an inconvenience — it's a betrayal of trust that
could damage real relationships.

We take that seriously. Please help us keep this software trustworthy.

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security or privacy bugs.**

Instead, email **benjamin@opencivics.co** with:

- A clear description of the issue
- Steps to reproduce (or a proof-of-concept)
- Your assessment of impact (confidentiality, integrity, availability)
- Whether you believe the issue is currently being exploited
- Your name / handle for credit (or a request to remain anonymous)

You'll receive an acknowledgment within **72 hours**. If you don't, please
follow up — your message may have been caught in a filter.

For especially sensitive disclosures, you may PGP-encrypt your report. Request
the current public key in your initial (non-sensitive) email.

---

## Disclosure policy

We follow a **90-day coordinated disclosure** window:

1. **Day 0:** You report the issue privately.
2. **Within 72 hours:** We acknowledge and begin investigating.
3. **Within 14 days:** We confirm or dispute the report and share a triage
   assessment (severity, scope, planned fix timeline).
4. **By day 90:** A fix is shipped to all known deployments. Public disclosure
   follows shortly after, with credit to the reporter (unless anonymity was
   requested).
5. **If the issue is being actively exploited**, we may shorten this timeline
   and ship an emergency fix.

We will not pursue legal action against good-faith security researchers who
follow this process.

---

## Privacy boundary commitments

Pod Life enforces a strict privacy invariant:

> A person can only see data scoped to pods they belong to. If Person A is in
> Pod 1 (with B) and Pod 2 (with C), then B must never see any evidence that C
> exists, and vice versa.

This applies to:

- **API responses** — partnerships, schedules, satisfaction scores, error
  messages.
- **Telegram messages** — both DMs and group chats.
- **Calendar events** written back to user calendars (event titles must not
  reveal other partners).
- **Timing patterns** — addressed by an optional privacy mode that adds
  scheduling jitter.

We use **defense in depth**:

1. **Application logic** scopes all queries to the authenticated person's
   pods/partnerships.
2. **PostgreSQL Row-Level Security** policies enforce access at the database
   level, so even an application bug can't leak data.
3. **Privacy scrub middleware** strips sensitive fields from API responses
   before they leave the server.
4. **Telegram privacy filters** validate every outbound message against pod
   membership.

Cross-pod data leaks are treated as **critical-severity** bugs even if no real
data is exposed (e.g., test environment leaks). The privacy boundary test
suite runs in CI and must pass before any change is merged.

---

## Encryption

### At rest

- **OAuth tokens** (Google Calendar, Microsoft Graph, Apple CalDAV credentials)
  are encrypted using **AES-256-GCM** before storage in PostgreSQL.
- The encryption key (`ENCRYPTION_KEY` env var) is a 32-byte hex string. It
  must be generated with `openssl rand -hex 32` and stored outside the database.
- If the encryption key is lost, all stored tokens become unrecoverable. Users
  must re-authenticate their calendars. This is by design — there is no
  backdoor.

### In transit

- All HTTP traffic must use TLS in production. Self-hosters are responsible
  for terminating TLS at their reverse proxy (Caddy, nginx, Traefik, etc.).
- The optimizer service is internal-only and should not be exposed publicly.

### Authentication

- We use **magic-link email** authentication. There are no passwords stored,
  ever.
- Calendar OAuth tokens are scoped minimally: `calendar.freebusy` and
  `calendar.events` only — never full calendar read access.
- Sessions are server-side, in Redis, with rotating signed cookie identifiers.

---

## Threat model

We design against:

- **Cross-pod data leakage** (the primary threat — see above).
- **Calendar OAuth token theft** (mitigated by encryption at rest, minimal
  scopes, and proactive token refresh).
- **Account takeover via email compromise** (mitigated by short-lived magic
  links and session invalidation on calendar disconnect).
- **Telegram bot impersonation** (mitigated by webhook secret validation).

We do **not** currently defend against:

- A fully compromised host (root access on the API server). Self-hosters who
  need this should consider hardware-backed key storage.
- Side-channel timing attacks on schedule proposals. The optional **privacy
  mode** adds scheduling jitter to mitigate timing correlation, but a
  determined attacker with deep observation could still infer some patterns.

---

## Self-hosting security

If you self-host Pod Life:

- **Generate a unique `ENCRYPTION_KEY`** per deployment. Don't copy from another
  install.
- **Back up the encryption key separately from the database.** A backup that
  contains the database but not the key is unreadable. A backup that contains
  the key but not the database is useless. You need both, stored in different
  trust domains.
- **Keep the host updated.** OS patches, Docker base images, and pnpm
  dependencies all matter.
- **Restrict the optimizer service to internal traffic only.** It has no auth
  layer (it trusts the API to be the only caller).
- **Use HTTPS in production** with a valid certificate (Let's Encrypt is fine).
- **Audit logs.** Pod Life writes structured logs; pipe them somewhere you can
  search and retain.

---

## Past advisories

None to date. This file will be updated as advisories are published.

---

Thank you for helping keep Pod Life trustworthy.

— Benjamin Life ([@omniharmonic](https://github.com/omniharmonic))
