/**
 * Magic link auth (per arch § 5.1).
 *
 * Flow:
 *   1. requestMagicLink(email) — generate token, hash, store, email link.
 *   2. verifyMagicLink(email, token) — find unused link, verify, mark used,
 *      upsert person, create session, return session token.
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  MAGIC_LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
} from '@pod-life/shared';
import { AuthError } from '../../lib/errors.js';
import { hashToken, verifyToken } from '../../lib/hash.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import { db } from '../../db/index.js';
import { auditLog, magicLinks, persons, sessions } from '../../db/schema.js';
import type { PersonRow } from '../../db/schema.js';
import { sendEmail } from '../../services/email/email.service.js';

export interface MagicLinkRequestResult {
  /** Always true to prevent email enumeration; magic link is sent if email is valid. */
  ok: true;
  /** Dev-only: present when SMTP not configured so devs can complete the flow. */
  devToken?: string;
  devVerifyUrl?: string;
}

export async function requestMagicLink(email: string): Promise<MagicLinkRequestResult> {
  const token = nanoid(40); // ~240 bits of entropy
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000);

  await db.insert(magicLinks).values({
    email,
    tokenHash,
    expiresAt,
  });

  // Use /verify (not /auth/verify) so the Vite dev proxy doesn't intercept
  // the browser navigation and forward it to the API as a GET (which 404s
  // because the API only exposes POST /auth/verify).
  const verifyUrl = `${config.frontendUrl}/verify?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  await sendEmail({
    to: email,
    subject: 'Your Pod Life sign-in link',
    text:
      `Hi! Click this link to sign in to Pod Life:\n\n${verifyUrl}\n\n` +
      `This link expires in ${MAGIC_LINK_TTL_MINUTES} minutes. If you didn't request it, you can safely ignore this email.`,
    html:
      `<p>Click to sign in to Pod Life:</p>` +
      `<p><a href="${verifyUrl}">${verifyUrl}</a></p>` +
      `<p style="color:#888">This link expires in ${MAGIC_LINK_TTL_MINUTES} minutes.</p>`,
  });

  logger.info('magic link requested', { email });

  if (!config.smtp.enabled || !config.isProduction) {
    return { ok: true, devToken: token, devVerifyUrl: verifyUrl };
  }
  return { ok: true };
}

export interface VerifyResult {
  sessionToken: string;
  person: PersonRow;
}

export async function verifyMagicLink(email: string, token: string): Promise<VerifyResult> {
  // Find any non-expired, unused link for this email — we'll verify by
  // re-hashing the supplied token against each candidate.
  const candidates = await db
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
    .limit(20);

  let matched: typeof candidates[number] | undefined;
  for (const c of candidates) {
    if (await verifyToken(token, c.tokenHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
    throw new AuthError('Invalid or expired magic link', 'INVALID_MAGIC_LINK');
  }

  // Mark used (replay prevention).
  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, matched.id));

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

  // Create session. Token is "<sessionId>.<random>" so we can look up the
  // row by id directly and only bcrypt-verify the random component.
  const rawSecret = nanoid(48);
  const secretHash = await hashToken(rawSecret);
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [created] = await db
    .insert(sessions)
    .values({
      personId: person.id,
      tokenHash: secretHash,
      expiresAt: sessionExpiresAt,
    })
    .returning();
  if (!created) throw new AuthError('Failed to create session', 'SESSION_CREATE_FAILED');
  const sessionToken = `${created.id}.${rawSecret}`;

  logger.info('session created', { personId: person.id });

  // Audit: account creation + login. Per P9.4 we want a paper trail.
  if (isNewAccount) {
    await db.insert(auditLog).values({
      personId: person.id,
      action: 'account.create',
      resourceType: 'person',
      resourceId: person.id,
      metadata: {},
    });
  }
  await db.insert(auditLog).values({
    personId: person.id,
    action: 'session.login',
    resourceType: 'session',
    resourceId: created.id,
    metadata: {},
  });

  return { sessionToken, person };
}

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
  // Loose UUID shape check; full verification happens server-side.
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
