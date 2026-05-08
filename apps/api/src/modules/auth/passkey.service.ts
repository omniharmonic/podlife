/**
 * Passkey (WebAuthn) auth — second-time-and-after sign-in path. After a
 * user has signed in once via the email-code flow, they can enroll a
 * passkey on their device; subsequent sign-ins are Face ID / Touch ID
 * with no email round-trip and no redirects (so it works perfectly inside
 * a standalone PWA).
 *
 * Two flows:
 *   - register{Options,Verify}  → enroll a credential against a logged-in person
 *   - authenticate{Options,Verify} → sign-in via assertion, returns a session
 *
 * Server holds the challenge in `webauthn_challenges` so multi-tab and
 * PWA-cold-start scenarios are robust (no reliance on browser state).
 */
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import { AuthError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import { db } from '../../db/index.js';
import {
  auditLog,
  persons,
  webauthnChallenges,
  webauthnCredentials,
} from '../../db/schema.js';
import type { PersonRow } from '../../db/schema.js';
import { createSessionFor } from './login-code.service.js';

const RP_NAME = 'Pod Life';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Derive the WebAuthn Relying Party ID from the configured frontend URL.
 * The RP ID is the eTLD+1 domain (host without scheme/port). Local dev
 * uses `localhost`, which the spec explicitly allows over HTTPS-or-loopback.
 */
function getRpId(): string {
  return new URL(config.frontendUrl).hostname;
}

function getOrigin(): string {
  return new URL(config.frontendUrl).origin;
}

// ─── Registration ──────────────────────────────────────────────────

export interface RegistrationStartResult {
  options: PublicKeyCredentialCreationOptionsJSON;
}

/**
 * Issue a fresh registration challenge for an authenticated user. Existing
 * credentials are excluded so the authenticator's UI can prompt the user
 * to use a *different* device than ones already enrolled.
 */
export async function startPasskeyRegistration(
  person: PersonRow,
): Promise<RegistrationStartResult> {
  const existing = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, person.id));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userID: new TextEncoder().encode(person.id),
    userName: person.email,
    userDisplayName: person.displayName,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      // Prefer platform authenticators (Face ID, Touch ID, Windows Hello).
      // Cross-platform keys (Yubikey etc) still work — this is just a hint.
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.insert(webauthnChallenges).values({
    personId: person.id,
    challenge: options.challenge,
    purpose: 'register',
    expiresAt,
  });

  return { options };
}

export interface RegistrationVerifyResult {
  credentialId: string;
  nickname: string | null;
}

export async function finishPasskeyRegistration(
  person: PersonRow,
  response: RegistrationResponseJSON,
  nickname?: string,
): Promise<RegistrationVerifyResult> {
  const challenge = await consumeChallenge(person.id, null, 'register');
  if (!challenge) {
    throw new AuthError('Passkey challenge expired — try again', 'CHALLENGE_EXPIRED');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError('Passkey registration failed', 'PASSKEY_REGISTRATION_FAILED');
  }

  const info = verification.registrationInfo;
  const cred = info.credential;
  const cleanNick = nickname?.trim().slice(0, 80) || null;

  // Insert with .returning() so we have the row's UUID for the audit log.
  // `audit_log.resource_id` is a `uuid` column — passing the credential's
  // base64url id (which is what WebAuthn calls "id") would blow up with a
  // "invalid input syntax for type uuid" error and 500 the request, even
  // though the device has already stored the passkey. The credential's
  // public id goes into metadata for later cross-referencing.
  const [stored] = await db
    .insert(webauthnCredentials)
    .values({
      personId: person.id,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey).toString('base64url'),
      counter: cred.counter,
      transports: cred.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      nickname: cleanNick,
    })
    .returning();
  if (!stored) {
    throw new AuthError('Passkey registration failed', 'PASSKEY_REGISTRATION_FAILED');
  }

  await db.insert(auditLog).values({
    personId: person.id,
    action: 'passkey.register',
    resourceType: 'webauthn_credential',
    resourceId: stored.id,
    metadata: {
      credentialId: cred.id,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    },
  });

  logger.info('passkey registered', { personId: person.id });
  return { credentialId: cred.id, nickname: cleanNick };
}

// ─── Authentication ────────────────────────────────────────────────

export interface AuthenticationStartResult {
  options: PublicKeyCredentialRequestOptionsJSON;
}

/**
 * Start a sign-in challenge. When `email` is provided we limit the allowed
 * credentials to that person's enrolled devices — the most common case.
 * Without `email` we issue an open challenge for usernameless flows where
 * the platform shows a credential picker (modern Chrome/Safari support).
 */
export async function startPasskeyAuthentication(
  email?: string,
): Promise<AuthenticationStartResult> {
  let allowCredentials:
    | { id: string; transports?: AuthenticatorTransportFuture[] }[]
    | undefined;
  let personId: string | null = null;

  if (email) {
    const [person] = await db
      .select()
      .from(persons)
      .where(eq(persons.email, email))
      .limit(1);
    if (person) {
      personId = person.id;
      const creds = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.personId, person.id));
      if (creds.length > 0) {
        allowCredentials = creds.map((c) => ({
          id: c.credentialId,
          transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
        }));
      }
    }
    // Don't leak whether the email exists — we always issue options. If
    // the email is unknown the assertion will simply fail to verify.
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: 'preferred',
    allowCredentials,
  });

  await db.insert(webauthnChallenges).values({
    personId,
    email: email ?? null,
    challenge: options.challenge,
    purpose: 'authenticate',
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });

  return { options };
}

export interface AuthenticationVerifyResult {
  sessionToken: string;
  person: PersonRow;
}

export async function finishPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  email?: string,
): Promise<AuthenticationVerifyResult> {
  // Look up the credential first — we need the public key for verification.
  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, response.id))
    .limit(1);
  if (!cred) {
    throw new AuthError('Unknown passkey', 'UNKNOWN_PASSKEY');
  }

  // Match the challenge by either personId or email so both the targeted
  // (email-known) and discovery (usernameless) flows work.
  const challenge = await consumeChallenge(cred.personId, email ?? null, 'authenticate');
  if (!challenge) {
    throw new AuthError('Passkey challenge expired — try again', 'CHALLENGE_EXPIRED');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
    credential: {
      id: cred.credentialId,
      publicKey: Buffer.from(cred.publicKey, 'base64url'),
      counter: cred.counter,
      transports: (cred.transports ?? []) as AuthenticatorTransportFuture[],
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    throw new AuthError('Passkey verification failed', 'PASSKEY_AUTH_FAILED');
  }

  // Persist the new counter + last-used timestamp. A counter that didn't
  // advance is acceptable on platform authenticators that always return 0;
  // we only care that the value didn't go *backward*, which the library
  // enforces internally before we get here.
  await db
    .update(webauthnCredentials)
    .set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(webauthnCredentials.id, cred.id));

  const [person] = await db
    .select()
    .from(persons)
    .where(eq(persons.id, cred.personId))
    .limit(1);
  if (!person) {
    throw new AuthError('Passkey is for an unknown person', 'UNKNOWN_PERSON');
  }

  const sessionToken = await createSessionFor(person.id, 'passkey');
  return { sessionToken, person };
}

// ─── Listing / deletion ────────────────────────────────────────────

export interface PasskeyListItem {
  id: string;
  nickname: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeys(personId: string): Promise<PasskeyListItem[]> {
  const rows = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, personId));
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    deviceType: r.deviceType,
    backedUp: r.backedUp,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

export async function deletePasskey(personId: string, passkeyId: string): Promise<boolean> {
  const result = await db
    .delete(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.id, passkeyId),
        eq(webauthnCredentials.personId, personId),
      ),
    )
    .returning();
  if (result.length > 0) {
    await db.insert(auditLog).values({
      personId,
      action: 'passkey.delete',
      resourceType: 'webauthn_credential',
      resourceId: passkeyId,
      metadata: {},
    });
    return true;
  }
  return false;
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Atomically pop the most recent challenge that matches our criteria. Also
 * sweeps any expired rows on the way out so the table doesn't grow.
 */
// Exported for the regression test in tests/passkey-challenge.test.ts.
// Internal API otherwise — callers should use the public flow above.
export async function consumeChallenge(
  personId: string | null,
  email: string | null,
  purpose: 'register' | 'authenticate',
): Promise<{ challenge: string } | null> {
  const now = new Date();

  // Best-effort cleanup — non-fatal if it errors.
  await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now)).catch(() => {});

  const baseConditions = [
    eq(webauthnChallenges.purpose, purpose),
    gt(webauthnChallenges.expiresAt, now),
  ];

  // Build the owner-matching predicate. Registration is always tied to a
  // specific authenticated user — strict match. Authentication has two
  // surfaces: a targeted flow (options endpoint received an email so the
  // challenge row has personId/email set) and a usernameless flow (the
  // user clicked "Sign in with a passkey" without typing their email, so
  // the challenge has both NULL and is matchable by any subsequently
  // resolved credential).
  let ownerMatch;
  if (purpose === 'register') {
    if (!personId) return null;
    ownerMatch = eq(webauthnChallenges.personId, personId);
  } else {
    const alternatives = [];
    if (personId) alternatives.push(eq(webauthnChallenges.personId, personId));
    if (email) alternatives.push(eq(webauthnChallenges.email, email));
    // Usernameless / discovery flow: challenge has no owner hint.
    alternatives.push(
      and(
        isNull(webauthnChallenges.personId),
        isNull(webauthnChallenges.email),
      ),
    );
    ownerMatch = alternatives.length === 1 ? alternatives[0] : or(...alternatives);
  }

  const rows = await db
    .select()
    .from(webauthnChallenges)
    .where(and(...baseConditions, ownerMatch))
    .orderBy(webauthnChallenges.createdAt);
  const latest = rows[rows.length - 1];
  if (!latest) return null;

  // Burn it — challenges are single-use.
  await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, latest.id));
  return { challenge: latest.challenge };
}
