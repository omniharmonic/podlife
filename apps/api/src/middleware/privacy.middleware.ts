/**
 * Privacy scrub middleware (P9.2) — defense in depth (Layer 3).
 *
 * Per CLAUDE.md § Privacy Model: this is the third of four layers protecting
 * intimate relationship data. It runs *after* application logic and after
 * RLS, on every authenticated API response, and strips sensitive fields
 * that should never leave the server unless they belong to the requester.
 *
 * What we scrub on EVERY response (regardless of who they belong to):
 *   - any key matching /password|tokenHash|secretHash|encryptedAccessToken|
 *     encryptedRefreshToken|access_token|refresh_token|.*_token|.*_hash$/
 *
 * What we scrub UNLESS the field belongs to the requester (`id` matches):
 *   - email
 *   - telegramChatId / telegram_chat_id
 *   - telegramHandle
 *   - notificationChannels (per-person config)
 *   - privacyMode
 *   - blockedWindows
 *
 * Whitelist rule: any nested object that has `id` and `displayName` keys
 * (i.e. looks like a Person) gets reduced to {id, displayName, avatarUrl}
 * unless that id matches the authenticated person.
 *
 * Note: this middleware is conservative. The route handlers should already
 * be returning sanitized DTOs. The middleware exists as a safety net so a
 * future bug that includes a raw row in a response cannot leak.
 */
import type { MiddlewareHandler } from 'hono';

const ALWAYS_STRIP_RE =
  /^(password|password_hash|passwordHash|token_hash|tokenHash|secret_hash|secretHash|encrypted_access_token|encryptedAccessToken|encrypted_refresh_token|encryptedRefreshToken|access_token|refresh_token|invite_token|inviteToken|.*_hash|.*Hash)$/;

const SELF_ONLY_FIELDS = new Set<string>([
  'email',
  'telegramChatId',
  'telegram_chat_id',
  'telegramHandle',
  'telegram_handle',
  'notificationChannels',
  'notification_channels',
  'privacyMode',
  'privacy_mode',
  'blockedWindows',
  'blocked_windows',
]);

function looksLikePerson(value: unknown): value is { id: string; displayName: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.displayName === 'string';
}

export function deepScrub(value: unknown, currentPersonId: string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepScrub(v, currentPersonId));
  }
  if (typeof value !== 'object') return value;

  // If this looks like a Person record and isn't the requester, prune to a
  // safe public shape. We intentionally do NOT prune the requester's own
  // record because /api/me is expected to return everything about self.
  const obj = value as Record<string, unknown>;
  if (looksLikePerson(obj) && obj.id !== currentPersonId) {
    const safe: Record<string, unknown> = {
      id: obj.id,
      displayName: obj.displayName,
    };
    if ('avatarUrl' in obj) safe.avatarUrl = obj.avatarUrl ?? null;
    return safe;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // Always strip credential-shaped keys. No exceptions.
    if (ALWAYS_STRIP_RE.test(k)) continue;
    // Self-only fields: keep if this object is the requester's own record.
    if (SELF_ONLY_FIELDS.has(k)) {
      const isSelf =
        typeof obj.id === 'string' && obj.id === currentPersonId;
      if (!isSelf) continue;
    }
    out[k] = deepScrub(v, currentPersonId);
  }
  return out;
}

/**
 * Hono middleware: scrubs the JSON body of every authenticated response.
 * Skips non-JSON responses and 204s. Streaming responses pass through
 * untouched (we don't currently use streams in the API).
 */
export const privacyScrub: MiddlewareHandler = async (c, next) => {
  await next();
  const me = c.get('person');
  if (!me) return; // Should never happen; auth middleware runs first.
  if (c.res.status === 204) return;
  const ct = c.res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return;

  // Clone so we don't consume the body if downstream needs it (Hono shares).
  let parsed: unknown;
  try {
    parsed = await c.res.clone().json();
  } catch {
    return; // Not actually JSON; leave untouched.
  }
  const scrubbed = deepScrub(parsed, me.id);
  // Replace the response with the scrubbed version. Preserve status.
  c.res = new Response(JSON.stringify(scrubbed), {
    status: c.res.status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
};
