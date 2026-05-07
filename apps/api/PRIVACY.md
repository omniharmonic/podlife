# Pod Life — Privacy Implementation

This document describes how Pod Life enforces the privacy invariants stated
in `CLAUDE.md` § Privacy Model. It is intended for engineers extending the
API and for reviewers auditing the system.

> **Core invariant:** A person can only see data scoped to pods they belong
> to. If Person A is in Pod 1 (with B) and Pod 2 (with C), then B must
> never see any evidence that C exists, and vice versa.

## Four-layer defense

Pod Life enforces the invariant in four independent layers. Each is
sufficient on its own to block the most common leaks; together they
provide defense in depth.

| Layer | Where | What it does |
|-------|-------|--------------|
| 1 — Application logic | `apps/api/src/modules/*/*.routes.ts` and `*.service.ts` | Every query is scoped to the authenticated person's pods/partnerships. Pod-access middleware (`requirePodMember`) gates pod-detail routes. |
| 2 — PostgreSQL Row-Level Security | `apps/api/src/db/post-migrate.sql` | RLS policies on `partnerships`, `partnership_preferences`, `pod_members`, `time_blocks` enforce cross-pod isolation at the database level. `FORCE ROW LEVEL SECURITY` ensures the policies apply even to the table-owning role. |
| 3 — Privacy scrub middleware | `apps/api/src/middleware/privacy.middleware.ts` | Runs after auth on every `/api/*` response. Strips credential-shaped keys (`*_hash`, `*_token`, `encrypted_*`) unconditionally; strips self-only fields (`email`, `telegramChatId`, `telegramHandle`, `notificationChannels`, `privacyMode`, `blockedWindows`) unless they belong to the requester. Reduces nested Person-shaped objects to `{id, displayName, avatarUrl}` for non-self records. |
| 4 — Telegram privacy filters | `apps/api/src/modules/telegram/privacy.ts` | Every outbound DM and group message is scanned against an allow-list of names. Word-boundary regex with case-insensitive match. A failed validation returns `delivered:false` and writes a `telegram_privacy_violation` audit row. |

## What's stored encrypted vs. plaintext

| Data | Storage | Notes |
|------|---------|-------|
| Calendar OAuth access/refresh tokens | `calendar_connections.encrypted_access_token` / `encrypted_refresh_token` (AES-256-GCM) | Encrypted at rest with `ENCRYPTION_KEY` (32-byte hex). Never logged. Vault helpers in `apps/api/src/services/encryption/vault.ts`. |
| Magic-link tokens | `magic_links.token_hash` (bcrypt) | Plaintext token only travels in the email link; only the hash persists. |
| Session tokens | `sessions.token_hash` (bcrypt) | Plaintext is `<sessionId>.<random>` returned to the client; only the hashed random component persists. |
| Pod invite tokens | Redis (`podlife:pod-invite:<token>`) | Short-lived (TTL ≤ pod-invite-ttl-days), one-shot. |
| Telegram link tokens | Redis (`podlife:tg-link:<token>`) | Short-lived (TTL ≤ link-ttl-seconds). |
| Telegram chat IDs | `persons.telegram_chat_id` (BIGINT) | Plaintext but never exposed to other persons (privacy scrub middleware enforces this). |
| Free/busy cache | Redis (`podlife:avail:<personId>:*`) | TTL'd; cleared on account deletion. |
| Display name, email, timezone, avatar | `persons` (plaintext) | Email is self-only; display name and avatar are visible to partners and pod members only. |

## Retention policy

* **Audit log** — kept indefinitely. `audit_log.person_id` is **NULL'd** when
  the referenced person is deleted (the FK has no cascade), preserving the
  trail without retaining PII. The `metadata` field on
  `account.delete` records is set to `{retainedAuditOnly: true}`.
* **Sessions, calendar connections, partnerships, partnership preferences,
  pod memberships, manual availability, notifications** — cascade-deleted
  with the person. (`ON DELETE CASCADE` on the FK to `persons.id`.)
* **Pods** that the deleted person *created* (`pods.created_by`) are
  deleted outright, since `created_by` is `NOT NULL`. Pods that someone
  else created and the user merely joined survive — only the person's
  `pod_members` row cascades away.
* **Partnerships** are cascade-deleted in both directions
  (`person_a_id`, `person_b_id` → `persons.id ON DELETE CASCADE`).
* **Time blocks** are NOT cascade-deleted; they remain in their owning
  cycle. Once the deleted person's `time_block_participants` row is
  removed by cascade, the block becomes unattached history that is
  invisible to that person but still visible to remaining participants
  via the participant relationship.

## Account deletion scope (`DELETE /api/me`)

The handler in `apps/api/src/modules/persons/persons.routes.ts` performs:

1. Inserts an `account.delete` audit row (with `personId: null`).
2. Calls `cleanupRedisForPerson(personId)` (in `persons.lifecycle.ts`)
   which scans and deletes:
   - `podlife:avail:<personId>:*` (free/busy cache)
   - `podlife:rl:*:<personId>` (rate-limit buckets)
3. Nulls `audit_log.person_id`, `scheduling_cycles.triggered_by`,
   `partner_invites.accepted_by` referencing this person.
4. Deletes `pods` where `created_by = me` (cascades members, prefs).
5. Deletes any `partnerships` where `invited_by = me` defensively.
6. `DELETE FROM persons` — Postgres cascades sessions,
   calendar_connections, partnerships, partnership_preferences,
   pod_members, time_block_participants, manual_availability,
   notifications.

After this completes, no row in any table contains the deleted person's
email, display name, telegram handle, telegram chat ID, OAuth tokens,
or partnership preferences.

## Privacy mode (P9.3 — timing inference mitigation)

`persons.privacy_mode BOOLEAN DEFAULT FALSE`. When true, the cycle
manager applies a deterministic-per-cycle ±30-minute jitter to the
person's free-window edges before sending the optimization request. The
jitter is seeded with `SHA-256(personId:cycleId)` so:

- The same cycle always yields the same proposal (reproducibility).
- Different cycles yield different proposals (an observer can't infer
  the underlying availability pattern).
- Jitter only **shrinks** windows; it never extends them past the user's
  actual free time.

Implementation: `applyPrivacyJitter` in
`apps/api/src/modules/schedule/cycle.manager.ts`. UI toggle in
`apps/web/src/pages/SettingsPage.tsx`.

## Audit log actions

The following actions are written to `audit_log`:

| Action | Resource type | Where |
|--------|---------------|-------|
| `account.create` | `person` | `magic-link.service.ts` (first verification of a new email) |
| `session.login` | `session` | `magic-link.service.ts` (every successful verification) |
| `account.delete` | `person` | `persons.routes.ts` `DELETE /api/me` |
| `person.update` | `person` | `persons.routes.ts` `PATCH /api/me` |
| `person.export` | `person` | `persons.routes.ts` `GET /api/me/export` |
| `partnership.create` | `partnership` | `partners.service.ts` `acceptInvite` |
| `partnership.preferences.update` | `partnership` | `partners.service.ts` `updateMyPreferences` |
| `partnership.dissolve` / `partnership.status` | `partnership` | `partners.service.ts` `updatePartnershipStatus` |
| `proposal.respond` | `time_block` | `schedule.routes.ts` `POST /proposals/:id/respond` |
| `schedule.reshuffle` | `time_block` | `schedule.routes.ts` `POST /reshuffle` |
| `telegram_send` | `notification` / `pod` | `services/notification/telegram.adapter.ts` |
| `telegram_privacy_violation` | `notification` / `pod` | `services/notification/telegram.adapter.ts` (when filter rejects) |
| `llm_call` | various | `modules/ai/ai.routes.ts` |

## Running the privacy boundary tests

The test suite in `apps/api/tests/privacy.test.ts` is non-optional. It
must be run in CI on every PR.

```bash
# All API tests (including privacy)
pnpm --filter @pod-life/api test

# Privacy boundary suite only
pnpm --filter @pod-life/api test tests/privacy.test.ts

# Type-check (must be clean before merging)
pnpm --filter @pod-life/api typecheck
```

The suite uses a V-structure fixture (`createVStructure` in
`tests/utils.ts`): A is partnered with both B and C, in two pods (one
each). B and C share no pod and no partnership. Every test verifies that
B sees nothing about C and vice versa.

If a privacy test fails, **stop merging**. Investigate before any other
work. The failure mode of a privacy bug is a real-life relationship
betrayal, not a regression.
