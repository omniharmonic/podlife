/**
 * Regression test for the passkey auth-verify 401:
 * a usernameless sign-in (no email entered before tapping "Sign in with a
 * passkey") creates a challenge with personId=NULL, but the verify path
 * looks the credential up first and then matches the challenge against
 * `cred.personId`. Without the OR-IS-NULL clause, that match never lands
 * on the anonymous challenge, and every usernameless sign-in fails with
 * "challenge expired". This test pins both that path AND the targeted
 * (email-typed) path that already worked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { webauthnChallenges, webauthnCredentials } from '../src/db/schema.ts';
import {
  consumeChallenge,
  deleteAllPasskeys,
  listPasskeys,
  startPasskeyAuthentication,
} from '../src/modules/auth/passkey.service.ts';
import { createTestPerson, deletePerson, uniqueEmail } from './utils.ts';

describe('passkey challenge resolution', () => {
  let createdEmails: string[] = [];

  afterEach(async () => {
    for (const e of createdEmails) await deletePerson(e);
    createdEmails = [];
  });

  it('matches a usernameless challenge against a known credential owner', async () => {
    // Set up: a real person who would own a passkey on their device.
    const email = uniqueEmail('passkey');
    createdEmails.push(email);
    const { personId } = await createTestPerson(email);

    // The user clicks "Sign in with a passkey" without entering email.
    // Backend issues an anonymous challenge — personId=NULL, email=NULL.
    await startPasskeyAuthentication(undefined);

    // Now imagine the device returns an assertion for a credential that
    // we look up and find belongs to `personId`. consumeChallenge must
    // find the anonymous challenge — that's the bug we just fixed.
    const challenge = await consumeChallenge(personId, null, 'authenticate');
    expect(challenge).not.toBeNull();
    expect(challenge?.challenge).toBeTypeOf('string');

    // Single-use: the row should be gone after consumption.
    const remaining = await db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.purpose, 'authenticate'));
    const stillForPerson = remaining.filter(
      (r) => r.personId === personId || r.personId === null,
    );
    expect(stillForPerson).toHaveLength(0);
  });

  it('still matches a targeted (email-keyed) challenge', async () => {
    const email = uniqueEmail('passkey-targeted');
    createdEmails.push(email);
    const { personId } = await createTestPerson(email);

    await startPasskeyAuthentication(email);

    const challenge = await consumeChallenge(personId, email, 'authenticate');
    expect(challenge).not.toBeNull();
  });

  it('deleteAllPasskeys removes only the calling person\'s passkeys', async () => {
    const ownerEmail = uniqueEmail('passkey-wipe-owner');
    const otherEmail = uniqueEmail('passkey-wipe-other');
    createdEmails.push(ownerEmail, otherEmail);
    const { personId: owner } = await createTestPerson(ownerEmail);
    const { personId: other } = await createTestPerson(otherEmail);

    // Seed two stranded credentials for the owner + one for someone else.
    await db.insert(webauthnCredentials).values([
      { personId: owner, credentialId: `cred-owner-1-${Date.now()}`, publicKey: 'aGk' },
      { personId: owner, credentialId: `cred-owner-2-${Date.now()}`, publicKey: 'aGk' },
      { personId: other, credentialId: `cred-other-${Date.now()}`, publicKey: 'aGk' },
    ]);

    const removed = await deleteAllPasskeys(owner);
    expect(removed).toBe(2);

    const ownerLeft = await listPasskeys(owner);
    expect(ownerLeft).toHaveLength(0);

    const otherLeft = await listPasskeys(other);
    expect(otherLeft).toHaveLength(1);

    // No-op safe: calling again returns 0, not an error.
    const removedAgain = await deleteAllPasskeys(owner);
    expect(removedAgain).toBe(0);
  });

  it('refuses to match a register-purpose challenge from another person', async () => {
    // Registration challenges must be strictly tied to the authenticated
    // user — the anonymous-OR fallback only applies to authenticate.
    const ownerEmail = uniqueEmail('passkey-reg-owner');
    const otherEmail = uniqueEmail('passkey-reg-other');
    createdEmails.push(ownerEmail, otherEmail);
    const { personId: owner } = await createTestPerson(ownerEmail);
    const { personId: other } = await createTestPerson(otherEmail);

    await db.insert(webauthnChallenges).values({
      personId: owner,
      challenge: 'reg-challenge-test',
      purpose: 'register',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const wrongPerson = await consumeChallenge(other, null, 'register');
    expect(wrongPerson).toBeNull();

    const rightPerson = await consumeChallenge(owner, null, 'register');
    expect(rightPerson?.challenge).toBe('reg-challenge-test');
  });
});
