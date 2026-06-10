/**
 * Email-code auth — replaces the older magic-link flow so that PWAs survive
 * the email→OS-browser→back hop that breaks deep links on iOS.
 *
 * Flow:
 *   1. requestLoginCode(email) — generate a 6-char code, hash, store, email.
 *   2. verifyLoginCode(email, code) — find latest unused code for this email,
 *      verify, mark used, upsert person, create session, return token.
 *
 * Wire compatibility: callers send the code as the `token` field on the
 * verify endpoint so existing test/client code keeps compiling. Internally
 * we always normalize (uppercase + strip separators) before hashing.
 */
import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MINUTES,
  SESSION_TTL_DAYS,
} from '@pod-life/shared';
import { AuthError } from '../../lib/errors.js';
import { hashToken, verifyToken } from '../../lib/hash.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import { redis, redisFor } from '../../lib/redis.js';
import { db } from '../../db/index.js';
import { auditLog, magicLinks, persons, sessions } from '../../db/schema.js';

// Per-email throttle on code requests: caps inbox spam and shrinks the
// guessing surface (each outstanding code allows LOGIN_CODE_MAX_ATTEMPTS
// guesses). When exceeded we silently no-op with a success-shaped response so
// the endpoint still never reveals whether an email is known.
const LOGIN_CODE_MAX_REQUESTS_PER_WINDOW = 5;
const LOGIN_CODE_REQUEST_WINDOW_SECONDS = 15 * 60;
const throttleKey = redisFor('login-req');

/** Stable, non-reversible tag for correlating logs without storing PII. */
function emailTag(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
}

async function overEmailRequestLimit(email: string): Promise<boolean> {
  // Best-effort: if Redis is unavailable, fail open (don't block sign-in).
  try {
    const key = throttleKey(emailTag(email));
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOGIN_CODE_REQUEST_WINDOW_SECONDS);
    }
    return count > LOGIN_CODE_MAX_REQUESTS_PER_WINDOW;
  } catch {
    return false;
  }
}
import type { PersonRow } from '../../db/schema.js';
import { sendEmail } from '../../services/email/email.service.js';
import {
  renderCodeFeature,
  renderLetter,
  renderLetterText,
} from '../../services/email/email-layout.js';

// 31-char alphabet — uppercase letters minus the visually ambiguous `I`,
// `O`, `L` and digits minus `0`, `1`. Avoids "did you mean an O or a 0?"
// support tickets and survives most fonts cleanly.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface LoginCodeRequestResult {
  /** Always true — never reveal whether the email is known. */
  ok: true;
  /**
   * Dev/test-only escape hatch. Present ONLY when NODE_ENV !== production AND
   * no real email transport is configured (Resend or SMTP). Production
   * responses never include this — emitting it would be a self-serve auth
   * bypass since anyone who knows an email could grab the code without
   * owning the inbox.
   */
  devToken?: string;
}

function generateCode(): string {
  let out = '';
  for (let i = 0; i < LOGIN_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Format a code for email display: `ABC-DEF` reads better than `ABCDEF`. */
function formatCodeForDisplay(code: string): string {
  if (code.length <= 3) return code;
  const mid = Math.floor(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

/**
 * Normalize user input. Codes are case-insensitive and tolerate the dash we
 * insert in the email + any spaces a user might paste in.
 */
function normalizeCode(input: string): string {
  return input.replace(/[\s\-_]/g, '').toUpperCase();
}

export async function requestLoginCode(email: string): Promise<LoginCodeRequestResult> {
  // Throttle (except in tests, which issue many codes per second). On limit,
  // return success-shaped without sending — no enumeration signal, no spam.
  if (!config.isTest && (await overEmailRequestLimit(email))) {
    logger.warn('login code request throttled', { emailTag: emailTag(email) });
    return { ok: true };
  }

  const code = generateCode();
  const tokenHash = await hashToken(code);
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MINUTES * 60_000);

  // Invalidate any still-valid codes for this email so only one is live at a
  // time — fewer concurrent guessing targets.
  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(magicLinks.email, email), isNull(magicLinks.usedAt)));

  await db.insert(magicLinks).values({
    email,
    tokenHash,
    expiresAt,
  });

  const display = formatCodeForDisplay(code);
  // Brand voice: editorial, lead with care. Subject line carries the code
  // so the lock-screen preview is useful even before the email opens.
  const letter = {
    eyebrow: 'A way back in',
    headline: `Welcome${''}.`,
    body: [
      `Your Pod Life sign-in code is below. Type or paste it where you ` +
        `left off — no link to chase, nothing to install.`,
      `It works once and expires in ${LOGIN_CODE_TTL_MINUTES} minutes — ` +
        `like most good things.`,
    ],
    feature: renderCodeFeature(display),
    postscript:
      `Didn't ask to sign in? You can safely ignore this letter — the ` +
      `code expires on its own.`,
  };
  const html = renderLetter(letter);
  // Plain-text counterpart includes the code in the body since the visual
  // feature block won't survive a text/plain rendering.
  const text =
    renderLetterText(letter) +
    '\n\n' +
    `Sign-in code: ${display}\n` +
    `Expires in ${LOGIN_CODE_TTL_MINUTES} minutes.`;
  await sendEmail({
    to: email,
    subject: `Your Pod Life sign-in code: ${display}`,
    text,
    html,
  });

  // Log a non-reversible tag, never the raw email (PII for an intimate-
  // relationship app, and these logs typically ship to an aggregator).
  logger.info('login code requested', { emailTag: emailTag(email) });

  // Only leak the code back to the client in non-production environments
  // where the email won't actually be delivered.
  const willReallySend =
    !config.isTest && (config.resend.enabled || config.smtp.enabled);
  if (!config.isProduction && !willReallySend) {
    return { ok: true, devToken: code };
  }
  return { ok: true };
}

export interface VerifyResult {
  sessionToken: string;
  person: PersonRow;
}

export async function verifyLoginCode(email: string, rawCode: string): Promise<VerifyResult> {
  const code = normalizeCode(rawCode);
  if (!code) {
    throw new AuthError('Invalid or expired login code', 'INVALID_LOGIN_CODE');
  }

  // Latest unused, unexpired code for this email. Older codes from the same
  // email are implicitly orphaned — they'll either expire or fail to match.
  const [latest] = await db
    .select()
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.email, email),
        isNull(magicLinks.usedAt),
        gt(magicLinks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(magicLinks.createdAt))
    .limit(1);

  if (!latest) {
    throw new AuthError('Invalid or expired login code', 'INVALID_LOGIN_CODE');
  }

  // Cap brute-force guesses against the low-entropy code space. Once the
  // limit is hit, burn the row so the user must request a fresh code.
  if (latest.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    await db
      .update(magicLinks)
      .set({ usedAt: new Date() })
      .where(eq(magicLinks.id, latest.id));
    throw new AuthError(
      'Too many incorrect codes — request a new one',
      'CODE_LOCKED',
    );
  }

  const ok = await verifyToken(code, latest.tokenHash);
  if (!ok) {
    await db
      .update(magicLinks)
      .set({ attempts: latest.attempts + 1 })
      .where(eq(magicLinks.id, latest.id));
    throw new AuthError('Invalid or expired login code', 'INVALID_LOGIN_CODE');
  }

  // Mark used (replay prevention).
  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, latest.id));

  // Upsert person.
  const existing = await db.select().from(persons).where(eq(persons.email, email)).limit(1);
  let person: PersonRow;
  let isNewAccount = false;
  if (existing.length === 0) {
    const [created] = await db
      .insert(persons)
      .values({
        email,
        displayName: email.split('@')[0] ?? 'New Person',
      })
      .returning();
    if (!created) throw new AuthError('Failed to create person', 'PERSON_CREATE_FAILED');
    person = created;
    isNewAccount = true;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    person = existing[0]!;
  }

  const sessionToken = await createSessionFor(person.id, 'code');

  if (isNewAccount) {
    await db.insert(auditLog).values({
      personId: person.id,
      action: 'account.create',
      resourceType: 'person',
      resourceId: person.id,
      metadata: {},
    });
  }

  return { sessionToken, person };
}

/**
 * Mint a new session row for a verified person and return the token. Used
 * by both the code flow above and the passkey flow (which has its own
 * verification path but identical session creation).
 */
export async function createSessionFor(
  personId: string,
  method: 'code' | 'passkey',
): Promise<string> {
  const rawSecret = nanoid(48);
  const secretHash = await hashToken(rawSecret);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [created] = await db
    .insert(sessions)
    .values({ personId, tokenHash: secretHash, expiresAt })
    .returning();
  if (!created) throw new AuthError('Failed to create session', 'SESSION_CREATE_FAILED');

  await db.insert(auditLog).values({
    personId,
    action: 'session.login',
    resourceType: 'session',
    resourceId: created.id,
    metadata: { method },
  });

  logger.info('session created', { personId, method });
  return `${created.id}.${rawSecret}`;
}

// ─── Back-compat shims ─────────────────────────────────────────────
//
// A few callers in the codebase (tests, calendar OAuth start) still import
// the old names. Re-exporting keeps them compiling while we migrate.
export const requestMagicLink = requestLoginCode;
export const verifyMagicLink = verifyLoginCode;

export async function logout(sessionToken: string): Promise<void> {
  const parsed = parseSessionToken(sessionToken);
  if (!parsed) return;
  await db.delete(sessions).where(eq(sessions.id, parsed.sessionId));
}

export interface ParsedToken {
  sessionId: string;
  secret: string;
}

export function parseSessionToken(token: string): ParsedToken | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (sessionId.length !== 36) return null;
  return { sessionId, secret };
}

/**
 * Validate a session token and return the authenticated person.
 * Returns null on any failure (expired, unknown, tampered).
 */
export async function resolveSession(token: string): Promise<PersonRow | null> {
  const parsed = parseSessionToken(token);
  if (!parsed) return null;

  const rows = await db
    .select({
      session: sessions,
      person: persons,
    })
    .from(sessions)
    .innerJoin(persons, eq(persons.id, sessions.personId))
    .where(and(eq(sessions.id, parsed.sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!(await verifyToken(parsed.secret, row.session.tokenHash))) return null;
  return row.person;
}
