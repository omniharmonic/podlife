/**
 * Regression: pin the privacy filter's word-boundary semantics so a
 * future "let's just regex this" refactor can't downgrade us back to
 * substring matching. The earlier multi-pod stress run flagged this as
 * a concern when seeing "Beatrix" near a test message containing
 * "Beatrice" — turned out the substring concern was speculative (the
 * filter already uses `\b…\b`), but the cost of accidentally regressing
 * is high enough that an explicit pin is worth keeping.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { persons, podMembers, pods } from '../src/db/schema.ts';
import { TelegramGroupPrivacyFilter } from '../src/modules/telegram/privacy.ts';
import { createTestPerson, deletePerson, uniqueEmail } from './utils.ts';

describe('privacy filter word boundaries', () => {
  let createdEmails: string[] = [];
  let createdPodIds: string[] = [];
  let renamedIds: string[] = [];
  let originalNames = new Map<string, string>();

  afterEach(async () => {
    for (const podId of createdPodIds) {
      await db.delete(podMembers).where(eq(podMembers.podId, podId));
      await db.delete(pods).where(eq(pods.id, podId));
    }
    createdPodIds = [];
    // Restore display names of any DB-resident persons we mutated.
    if (renamedIds.length > 0) {
      for (const id of renamedIds) {
        const original = originalNames.get(id);
        if (original) {
          await db.update(persons).set({ displayName: original }).where(eq(persons.id, id));
        }
      }
    }
    renamedIds = [];
    originalNames = new Map();
    for (const e of createdEmails) await deletePerson(e);
    createdEmails = [];
  });

  it('does not flag a substring of a pod-member name as a leak', async () => {
    // Build a small world: one pod with a member named "Beatrix"; a
    // separate person named "Cassian" lives outside the pod.
    const beatrixEmail = uniqueEmail('priv-beatrix');
    const cassianEmail = uniqueEmail('priv-cassian');
    const podOwnerEmail = uniqueEmail('priv-owner');
    createdEmails.push(beatrixEmail, cassianEmail, podOwnerEmail);
    const beatrix = await createTestPerson(beatrixEmail);
    const cassian = await createTestPerson(cassianEmail);
    const owner = await createTestPerson(podOwnerEmail);

    // Force the display names so the test is deterministic regardless of
    // what createTestPerson seeds. We capture and restore originals in
    // afterEach.
    for (const id of [beatrix.personId, cassian.personId, owner.personId]) {
      const row = await db.select().from(persons).where(eq(persons.id, id)).limit(1);
      if (row[0]) originalNames.set(id, row[0].displayName);
      renamedIds.push(id);
    }
    await db.update(persons).set({ displayName: 'Beatrix' }).where(eq(persons.id, beatrix.personId));
    await db.update(persons).set({ displayName: 'Cassian' }).where(eq(persons.id, cassian.personId));
    await db.update(persons).set({ displayName: 'Hosanna' }).where(eq(persons.id, owner.personId));

    const [pod] = await db
      .insert(pods)
      .values({ name: `WordBoundary-${Date.now()}`, createdBy: owner.personId })
      .returning();
    if (!pod) throw new Error('pod insert failed');
    createdPodIds.push(pod.id);
    await db.insert(podMembers).values([
      { podId: pod.id, personId: owner.personId, role: 'admin', joinedAt: new Date() },
      { podId: pod.id, personId: beatrix.personId, role: 'member', joinedAt: new Date() },
    ]);

    const filter = new TelegramGroupPrivacyFilter();

    // Pod members are Beatrix + Hosanna. Cassian lives outside the pod and
    // is in the disallow set. Substring tests:

    // (a) "Beatrix" alone → allowed (pod member).
    expect((await filter.validate(pod.id, 'Beatrix is here')).ok).toBe(true);

    // (b) "Beatrice" → must NOT match against "Beatrix" (substring concern).
    //     Beatrice is no person we know; the message is fine.
    expect((await filter.validate(pod.id, 'A friend named Beatrice stopped by')).ok).toBe(true);

    // (c) "Cassiana" / "Cassiano" → must NOT match against "Cassian"
    //     (longer-suffix concern).
    expect((await filter.validate(pod.id, 'A character called Cassiana')).ok).toBe(true);
    expect((await filter.validate(pod.id, 'A coworker called Cassiano')).ok).toBe(true);

    // (d) Plain "Cassian" as a whole word → IS a leak (he's not in the pod).
    expect((await filter.validate(pod.id, 'Cassian dropped by tonight')).ok).toBe(false);

    // (e) Punctuation should still trip the boundary correctly.
    expect((await filter.validate(pod.id, 'Reminder: Cassian, please call.')).ok).toBe(false);
  });
});
