/**
 * Regression test for the "pod cycle drags in non-pod partners" surprise
 * surfaced by the multi-pod stress run. After the fix, a cycle triggered
 * with a podId should resolve to that pod's members only — the trigger's
 * partners outside the pod stay out. The whole-life path (no podId) is
 * unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.ts';
import { partnerships, podMembers, pods } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import { getInvolvedPersonIds } from '../src/modules/schedule/cycle.manager.ts';
import { createTestPerson, deletePerson, uniqueEmail } from './utils.ts';

describe('getInvolvedPersonIds scope', () => {
  let createdEmails: string[] = [];
  let createdPodIds: string[] = [];

  afterEach(async () => {
    for (const podId of createdPodIds) {
      await db.delete(podMembers).where(eq(podMembers.podId, podId));
      await db.delete(pods).where(eq(pods.id, podId));
    }
    createdPodIds = [];
    for (const e of createdEmails) await deletePerson(e);
    createdEmails = [];
  });

  it('pod-scoped cycle excludes the trigger\'s non-pod partners', async () => {
    // Trigger person T has two partners: P1 (in pod P) and P2 (NOT in pod P).
    // T also has another partner P3 outside everything.
    const tEmail = uniqueEmail('scope-t');
    const p1Email = uniqueEmail('scope-p1');
    const p2Email = uniqueEmail('scope-p2');
    const p3Email = uniqueEmail('scope-p3');
    createdEmails.push(tEmail, p1Email, p2Email, p3Email);
    const t = await createTestPerson(tEmail);
    const p1 = await createTestPerson(p1Email);
    const p2 = await createTestPerson(p2Email);
    const p3 = await createTestPerson(p3Email);

    // Three partnerships, all involving T.
    for (const partner of [p1, p2, p3]) {
      const [a, b] = t.personId < partner.personId
        ? [t.personId, partner.personId]
        : [partner.personId, t.personId];
      await db.insert(partnerships).values({
        personAId: a,
        personBId: b,
        invitedBy: t.personId,
        status: 'active',
      });
    }

    // Pod containing T + P1 only.
    const [pod] = await db
      .insert(pods)
      .values({ name: `Scope-${Date.now()}`, createdBy: t.personId })
      .returning();
    if (!pod) throw new Error('pod insert');
    createdPodIds.push(pod.id);
    await db.insert(podMembers).values([
      { podId: pod.id, personId: t.personId, role: 'admin', joinedAt: new Date() },
      { podId: pod.id, personId: p1.personId, role: 'member', joinedAt: new Date() },
    ]);

    // Pod-scoped: just {T, P1}. Should NOT include P2 or P3.
    const podScope = await getInvolvedPersonIds(t.personId, pod.id);
    expect(podScope.sort()).toEqual([t.personId, p1.personId].sort());

    // Whole-life: {T, P1, P2, P3} via partnerships, plus pod's members.
    const wholeLife = await getInvolvedPersonIds(t.personId);
    expect(new Set(wholeLife)).toEqual(
      new Set([t.personId, p1.personId, p2.personId, p3.personId]),
    );
  });
});
