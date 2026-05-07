/**
 * Telegram privacy filter tests (P9.1 boundary).
 *
 * V-structure: Person A has separate pods with B (Pod1) and C (Pod2).
 * A DM crafted for A must not reveal C's name; a Pod1 group chat must not
 * reveal C's name or Pod2's name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { persons, pods, podMembers, partnerships } from '../src/db/schema.ts';
import {
  TelegramDmPrivacyFilter,
  TelegramGroupPrivacyFilter,
} from '../src/modules/telegram/privacy.ts';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

async function makePerson(email: string, displayName: string): Promise<string> {
  const app = newApp();
  const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
  const v = await call(app, '/auth/verify', {
    method: 'POST',
    json: { email, token: r.body.devToken },
  });
  const id = v.body.person.id as string;
  await db.update(persons).set({ displayName }).where(eq(persons.id, id));
  return id;
}

describe('telegram privacy filters', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('DM filter rejects messages mentioning a person outside my partnerships', async () => {
    // V-structure: A partners with B (active). C is unrelated to A.
    const aEmail = uniqueEmail('tpa');
    const bEmail = uniqueEmail('tpb');
    const cEmail = uniqueEmail('tpc');
    created.push(aEmail, bEmail, cEmail);
    const aId = await makePerson(aEmail, 'Aurelius');
    const bId = await makePerson(bEmail, 'Bellatrix');
    const cId = await makePerson(cEmail, 'Caspian');

    // Create A-B partnership directly.
    const [aSorted, bSorted] = aId < bId ? [aId, bId] : [bId, aId];
    await db.insert(partnerships).values({
      personAId: aSorted,
      personBId: bSorted,
      status: 'active',
      invitedBy: aId,
    });

    const filter = new TelegramDmPrivacyFilter();

    // OK: mentions only A and B.
    const ok = await filter.validate(aId, 'Hi Aurelius — your hangout with Bellatrix is set.');
    expect(ok.ok).toBe(true);

    // Leak: mentions Caspian (a different pod / unrelated to A).
    const bad = await filter.validate(aId, 'You and Caspian have a conflict.');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('Caspian');

    void cId;
  });

  it('Group filter rejects mentions of non-pod-members and other pod names', async () => {
    const aEmail = uniqueEmail('tga');
    const bEmail = uniqueEmail('tgb');
    const cEmail = uniqueEmail('tgc');
    created.push(aEmail, bEmail, cEmail);
    const aId = await makePerson(aEmail, 'Atticus');
    const bId = await makePerson(bEmail, 'Beatrice');
    const cId = await makePerson(cEmail, 'Callista');

    // Pod1 (A, B). Pod2 (A, C).
    const [pod1] = await db.insert(pods).values({ name: 'Hearth', createdBy: aId }).returning();
    const [pod2] = await db.insert(pods).values({ name: 'Garden', createdBy: aId }).returning();
    const podOne = pod1!;
    const podTwo = pod2!;
    await db.insert(podMembers).values([
      { podId: podOne.id, personId: aId, role: 'admin', joinedAt: new Date() },
      { podId: podOne.id, personId: bId, role: 'member', joinedAt: new Date() },
      { podId: podTwo.id, personId: aId, role: 'admin', joinedAt: new Date() },
      { podId: podTwo.id, personId: cId, role: 'member', joinedAt: new Date() },
    ]);

    const filter = new TelegramGroupPrivacyFilter();

    // OK: mentions only Pod1 members.
    const ok = await filter.validate(
      podOne.id,
      "Hearth's schedule: Atticus & Beatrice — Tuesday at 19:00.",
    );
    expect(ok.ok).toBe(true);

    // Leak: mentions Callista (Pod2 member).
    const leak1 = await filter.validate(
      podOne.id,
      'Reminder: Callista is hanging with Atticus tonight.',
    );
    expect(leak1.ok).toBe(false);
    expect(leak1.reason).toContain('Callista');

    // Leak: mentions the OTHER pod by name.
    const leak2 = await filter.validate(
      podOne.id,
      'Atticus is in Garden tonight — see you Wednesday.',
    );
    expect(leak2.ok).toBe(false);
    expect(leak2.reason).toContain('Garden');
  });
});
