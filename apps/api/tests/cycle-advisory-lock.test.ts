/**
 * Per-person advisory lock regression tests.
 *
 * The cross-cycle soft-claim (proposed/accepted/locked blocks visible to
 * other cycles) closes the over-promise gap when cycles are even slightly
 * temporally separated, but pure simultaneous Promise.all triggers can
 * still race — both cycles read committed blocks before either persists.
 *
 * The lock fix wraps the read+solve+persist span in a Postgres transaction
 * that calls pg_advisory_xact_lock(hashtext(personId)) for every person,
 * sorted, so any two cycles touching overlapping persons serialize.
 *
 * These tests pin two contracts:
 *   1. Two cycles that SHARE a person serialize correctly — zero
 *      cross-cycle collisions even when triggered via Promise.all.
 *   2. Two cycles with NO shared persons run in parallel — wall-clock is
 *      roughly max(t1, t2), not t1+t2. (Otherwise we'd have introduced a
 *      false serialization that hurts performance.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  manualAvailability,
  partnerships,
  partnershipPreferences,
  podMembers,
  pods,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../src/db/schema.ts';
import {
  computeHorizon,
  processCycleJob,
} from '../src/modules/schedule/cycle.manager.ts';
import { createTestPerson, deletePerson, uniqueEmail } from './utils.ts';

async function setupAvailability(personId: string, start: Date, hours: number): Promise<void> {
  await db.insert(manualAvailability).values({
    personId,
    startTime: start,
    endTime: new Date(start.getTime() + hours * 3_600_000),
  });
}

async function makePartnership(p1: string, p2: string): Promise<string> {
  const [first, second] = p1 < p2 ? [p1, p2] : [p2, p1];
  const [row] = await db
    .insert(partnerships)
    .values({
      personAId: first,
      personBId: second,
      invitedBy: p1,
      status: 'active',
    })
    .returning();
  if (!row) throw new Error('partnership insert failed');
  for (const owner of [p1, p2]) {
    await db.insert(partnershipPreferences).values({
      partnershipId: row.id,
      personId: owner,
      needMinHours: '2',
      prefIdealHours: '4',
      needMinDateNights: 1,
      prefDateNights: 1,
    });
  }
  return row.id;
}

async function makePod(name: string, members: string[]): Promise<string> {
  const [row] = await db
    .insert(pods)
    .values({ name: `${name}-${Date.now()}`, createdBy: members[0]!, schedulingCadence: 'weekly' })
    .returning();
  if (!row) throw new Error('pod insert failed');
  for (const m of members) {
    await db.insert(podMembers).values({
      podId: row.id,
      personId: m,
      role: m === members[0] ? 'admin' : 'member',
      joinedAt: new Date(),
    });
  }
  return row.id;
}

async function newCycle(triggererId: string, personIds: string[]): Promise<string> {
  const { start, end } = computeHorizon();
  const [c] = await db
    .insert(schedulingCycles)
    .values({
      status: 'collecting',
      horizonStart: start,
      horizonEnd: end,
      triggeredBy: triggererId,
      triggerType: 'manual',
      personIds,
    })
    .returning();
  if (!c) throw new Error('cycle insert failed');
  return c.id;
}

async function countCrossCycleCollisions(cycleAId: string, cycleBId: string): Promise<number> {
  const aBlocks = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycleAId));
  const bBlocks = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycleBId));
  if (aBlocks.length === 0 || bBlocks.length === 0) return 0;
  const allBlockIds = [...aBlocks.map((b) => b.id), ...bBlocks.map((b) => b.id)];
  const parts = await db
    .select()
    .from(timeBlockParticipants)
    .where(inArray(timeBlockParticipants.timeBlockId, allBlockIds));
  const partsByBlock = new Map<string, Set<string>>();
  for (const p of parts) {
    const s = partsByBlock.get(p.timeBlockId) ?? new Set();
    s.add(p.personId);
    partsByBlock.set(p.timeBlockId, s);
  }
  let collisions = 0;
  for (const a of aBlocks) {
    for (const b of bBlocks) {
      if (a.endTime <= b.startTime || b.endTime <= a.startTime) continue;
      const aSet = partsByBlock.get(a.id) ?? new Set<string>();
      const bSet = partsByBlock.get(b.id) ?? new Set<string>();
      for (const pid of aSet) if (bSet.has(pid)) collisions++;
    }
  }
  return collisions;
}

describe('cycle advisory locks', () => {
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

  it('two parallel cycles sharing a person serialize — zero cross-cycle collisions', async () => {
    // Three people: shared (in both pods), aOnly (in pod1 with shared),
    // bOnly (in pod2 with shared). Both pods want the same evening
    // window with the shared person. Pre-fix the parallel cycles read
    // committed=∅ at the same instant and double-booked shared.
    const sharedEmail = uniqueEmail('lock-shared');
    const aEmail = uniqueEmail('lock-a');
    const bEmail = uniqueEmail('lock-b');
    createdEmails.push(sharedEmail, aEmail, bEmail);
    const shared = await createTestPerson(sharedEmail);
    const a = await createTestPerson(aEmail);
    const b = await createTestPerson(bEmail);

    const evening = new Date();
    evening.setUTCHours(24 + 23, 0, 0, 0);
    for (const pid of [shared.personId, a.personId, b.personId]) {
      await setupAvailability(pid, evening, 4);
    }

    await makePartnership(shared.personId, a.personId);
    await makePartnership(shared.personId, b.personId);
    const pod1 = await makePod('LockShared1', [shared.personId, a.personId]);
    const pod2 = await makePod('LockShared2', [shared.personId, b.personId]);
    createdPodIds.push(pod1, pod2);

    const cycle1 = await newCycle(shared.personId, [shared.personId, a.personId]);
    const cycle2 = await newCycle(shared.personId, [shared.personId, b.personId]);

    // Parallel trigger via Promise.all — pre-fix this reliably surfaced
    // cross-cycle collisions on the shared person. With locks, one cycle
    // waits for the other inside processCycleJob.
    await Promise.all([
      processCycleJob({ cycleId: cycle1 }),
      processCycleJob({ cycleId: cycle2 }),
    ]);

    expect(await countCrossCycleCollisions(cycle1, cycle2)).toBe(0);
  });

  it('two parallel cycles with NO shared persons do not block each other', async () => {
    // Four people in two disjoint pods. The locks must NOT serialize
    // them. We probe this by *holding* the lock for one person from a
    // separate connection and verifying that a cycle on a different
    // person still completes — i.e., the lock acquisition only blocks
    // when the person sets actually overlap.
    const aEmail = uniqueEmail('lock-disjoint-a');
    const bEmail = uniqueEmail('lock-disjoint-b');
    const cEmail = uniqueEmail('lock-disjoint-c');
    const dEmail = uniqueEmail('lock-disjoint-d');
    createdEmails.push(aEmail, bEmail, cEmail, dEmail);
    const aP = await createTestPerson(aEmail);
    const bP = await createTestPerson(bEmail);
    const cP = await createTestPerson(cEmail);
    const dP = await createTestPerson(dEmail);

    const evening = new Date();
    evening.setUTCHours(24 + 23, 0, 0, 0);
    for (const pid of [aP.personId, bP.personId, cP.personId, dP.personId]) {
      await setupAvailability(pid, evening, 4);
    }

    await makePartnership(aP.personId, bP.personId);
    await makePartnership(cP.personId, dP.personId);
    const pod1 = await makePod('LockDisjoint1', [aP.personId, bP.personId]);
    const pod2 = await makePod('LockDisjoint2', [cP.personId, dP.personId]);
    createdPodIds.push(pod1, pod2);

    // Probe the lock surface directly: open a tx on one connection that
    // holds aP's advisory lock, then verify a cycle on the disjoint
    // {cP, dP} pair completes without timing out. If the locks were
    // over-broad (e.g. global), the second cycle would block forever
    // and our 5s lock_timeout in processCycleJob would error.
    const cycle1 = await newCycle(cP.personId, [cP.personId, dP.personId]);

    let probeTxResolved = false;
    const release = new Promise<void>((resolve) => {
      // Acquire aP's lock from a separate tx. We deliberately do not
      // commit until told to release — this simulates a long-running
      // cycle holding the lock for personId aP.
      void db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${aP.personId}))`,
        );
        probeTxResolved = true;
        // Hold until the test signals release.
        await new Promise<void>((r) => setTimeout(r, 1500));
        resolve();
      });
    });
    // Wait for the probe tx to actually hold the lock before launching
    // the disjoint cycle. (Polling here is the cleanest way to avoid a
    // race where the cycle runs before the probe acquires.)
    while (!probeTxResolved) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Now run the disjoint cycle. With per-person locks, this MUST NOT
    // wait on the probe — different persons, different lock keys.
    const t0 = Date.now();
    await processCycleJob({ cycleId: cycle1 });
    const elapsedMs = Date.now() - t0;

    // The disjoint cycle should complete well under the probe's 1500ms
    // hold window. If it takes >1s we're effectively serializing and
    // the lock granularity is wrong.
    expect(elapsedMs).toBeLessThan(1000);

    // Drain the probe so afterEach can clean up its persons.
    await release;
  }, 30_000);
});
