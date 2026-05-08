/**
 * Regression test for the cycle-timing finding from the multi-pod stress
 * run: when two cycles for overlapping pods ran in parallel, the second
 * cycle couldn't see the first cycle's `proposed` blocks (only `locked`),
 * so it would over-schedule into the same windows on shared participants.
 * The fix broadened `loadCommittedBlocks` to include any block from
 * another cycle whose status is `proposed`, `accepted`, or `locked`. This
 * test pins that contract end-to-end via processCycleJob.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
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

describe('cycle soft-claim (cross-cycle visibility)', () => {
  let createdEmails: string[] = [];

  afterEach(async () => {
    for (const e of createdEmails) await deletePerson(e);
    createdEmails = [];
  });

  it("sees another cycle's proposed blocks as busy and avoids double-booking", async () => {
    // Three people, two pods, one shared person across both pods. The
    // shared person has just enough availability for one block; whichever
    // pod cycles first takes it, the other must see it as soft-busy.
    const sharedEmail = uniqueEmail('soft-shared');
    const aEmail = uniqueEmail('soft-pod1');
    const bEmail = uniqueEmail('soft-pod2');
    createdEmails.push(sharedEmail, aEmail, bEmail);
    const shared = await createTestPerson(sharedEmail);
    const a = await createTestPerson(aEmail);
    const b = await createTestPerson(bEmail);

    // Tight 4-hour evening window in 2 days — wide enough for one Date
    // Night, narrow enough that a second can't fit.
    const tomorrowUTC = new Date();
    tomorrowUTC.setUTCHours(24, 0, 0, 0);
    const evening = new Date(tomorrowUTC.getTime() + 2 * 86_400_000);
    evening.setUTCHours(23, 0, 0, 0); // 23:00 UTC ≈ evening for America/Denver
    for (const personId of [shared.personId, a.personId, b.personId]) {
      await setupAvailability(personId, evening, 4);
    }

    // Two partnerships: shared↔a, shared↔b. Both ask for a 2h need_min.
    async function addPartnership(p1: string, p2: string): Promise<string> {
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
      if (!row) throw new Error('partnership insert');
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

    await addPartnership(shared.personId, a.personId);
    await addPartnership(shared.personId, b.personId);

    // Two pods: pod1 = {shared, a}, pod2 = {shared, b}.
    async function makePod(name: string, members: string[]): Promise<string> {
      const [row] = await db
        .insert(pods)
        .values({ name: `${name}-${Date.now()}`, createdBy: members[0]!, schedulingCadence: 'weekly' })
        .returning();
      if (!row) throw new Error('pod insert');
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

    const pod1 = await makePod('Soft1', [shared.personId, a.personId]);
    const pod2 = await makePod('Soft2', [shared.personId, b.personId]);

    // Helper: insert a cycle row directly (skip the queue-enqueue path so
    // the test runs synchronously without a worker fight).
    const { start: hStart, end: hEnd } = computeHorizon();
    async function newCycle(personIds: string[]): Promise<string> {
      const [c] = await db
        .insert(schedulingCycles)
        .values({
          status: 'collecting',
          horizonStart: hStart,
          horizonEnd: hEnd,
          triggeredBy: shared.personId,
          triggerType: 'manual',
          personIds,
        })
        .returning();
      if (!c) throw new Error('cycle insert');
      return c.id;
    }

    const cycle1 = await newCycle([shared.personId, a.personId]);
    await processCycleJob({ cycleId: cycle1 });

    // Confirm pod1 produced at least one block for the shared person.
    const cycle1Blocks = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycle1));
    expect(cycle1Blocks.length).toBeGreaterThan(0);

    // Now run pod2's cycle. Pre-fix this would have proposed in the same
    // window as cycle1; post-fix it should see cycle1's proposed block as
    // busy and either skip or pick a non-overlapping slot.
    const cycle2 = await newCycle([shared.personId, b.personId]);
    await processCycleJob({ cycleId: cycle2 });
    const cycle2Blocks = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycle2));

    // Cross-cycle collision check on the shared person: no time block in
    // cycle2 can overlap with cycle1 if the shared person is in both.
    const allBlocks = [...cycle1Blocks, ...cycle2Blocks];
    const partRows = allBlocks.length
      ? await db
          .select()
          .from(timeBlockParticipants)
          .where(inArray(timeBlockParticipants.timeBlockId, allBlocks.map((b) => b.id)))
      : [];
    const partsByBlock = new Map<string, Set<string>>();
    for (const p of partRows) {
      const s = partsByBlock.get(p.timeBlockId) ?? new Set();
      s.add(p.personId);
      partsByBlock.set(p.timeBlockId, s);
    }

    let collisions = 0;
    for (const a of cycle1Blocks) {
      for (const b of cycle2Blocks) {
        if (a.endTime <= b.startTime || b.endTime <= a.startTime) continue;
        const aSet = partsByBlock.get(a.id) ?? new Set();
        const bSet = partsByBlock.get(b.id) ?? new Set();
        for (const pid of aSet) if (bSet.has(pid)) collisions++;
      }
    }
    expect(collisions).toBe(0);

    void pod1;
    void pod2;
  });
});
