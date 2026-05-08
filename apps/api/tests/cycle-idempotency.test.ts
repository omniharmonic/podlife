/**
 * Regression test for the cycle-doubling bug surfaced by the multi-pod
 * stress runner. processCycleJob used to mutate state unconditionally,
 * so a queue retry (BullMQ attempts: 3, QStash native retries) — or the
 * synchronous /_test/run-now backdoor racing against a worker pickup —
 * inserted every proposed block twice. The fix is a status-guarded
 * atomic claim: only a cycle still in 'collecting' is processed; the
 * second caller bails with `skipped: true`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../src/db/schema.ts';
import { processCycleJob } from '../src/modules/schedule/cycle.manager.ts';
import {
  createTestPerson,
  deletePerson,
  uniqueEmail,
} from './utils.ts';

describe('cycle idempotency', () => {
  let createdEmails: string[] = [];

  afterEach(async () => {
    for (const e of createdEmails) await deletePerson(e);
    createdEmails = [];
  });

  it('skips a cycle that has already been processed', async () => {
    const email = uniqueEmail('cycle-idem');
    createdEmails.push(email);
    const { personId } = await createTestPerson(email);

    // Insert a cycle row already past 'collecting'. The status guard must
    // refuse to reprocess it — this is what protects us from a queue
    // retry double-persisting after the first attempt succeeded.
    const start = new Date();
    const end = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const [cycle] = await db
      .insert(schedulingCycles)
      .values({
        status: 'proposed',
        horizonStart: start,
        horizonEnd: end,
        triggeredBy: personId,
        triggerType: 'manual',
        personIds: [personId],
      })
      .returning();
    expect(cycle).toBeDefined();

    const result = (await processCycleJob({ cycleId: cycle!.id })) as {
      ok: boolean;
      skipped?: boolean;
      status?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.status).toBe('proposed');

    // No blocks should have been inserted.
    const blocks = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycle!.id));
    expect(blocks).toHaveLength(0);

    // Cycle row left untouched.
    const after = await db
      .select()
      .from(schedulingCycles)
      .where(eq(schedulingCycles.id, cycle!.id))
      .limit(1);
    expect(after[0]?.status).toBe('proposed');
  });

  it('only one of two concurrent processCycleJob calls runs the body', async () => {
    // The atomic claim (UPDATE ... WHERE status = 'collecting' RETURNING)
    // means whichever caller commits first wins; the other's UPDATE
    // affects 0 rows and bails with skipped=true. We don't have to mock
    // the optimizer — even with both racing on the same cycle id, exactly
    // one execution should produce blocks.
    const email = uniqueEmail('cycle-race');
    createdEmails.push(email);
    const { personId } = await createTestPerson(email);

    const start = new Date();
    const end = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const [cycle] = await db
      .insert(schedulingCycles)
      .values({
        status: 'collecting',
        horizonStart: start,
        horizonEnd: end,
        triggeredBy: personId,
        triggerType: 'manual',
        personIds: [personId],
      })
      .returning();
    expect(cycle).toBeDefined();

    const [r1, r2] = await Promise.all([
      processCycleJob({ cycleId: cycle!.id }) as Promise<{ skipped?: boolean }>,
      processCycleJob({ cycleId: cycle!.id }) as Promise<{ skipped?: boolean }>,
    ]);

    // Exactly one of the two should have run; the other should have
    // returned `skipped: true`.
    const skipped = [r1.skipped, r2.skipped].filter((s) => s === true).length;
    expect(skipped).toBe(1);

    // Lone-person cycle proposes nothing (no partnerships, no pods), so
    // we don't assert on block count here — only that the cycle moved
    // from collecting to a terminal status exactly once.
    const after = await db
      .select()
      .from(schedulingCycles)
      .where(eq(schedulingCycles.id, cycle!.id))
      .limit(1);
    expect(after[0]?.status).not.toBe('collecting');

    // Belt-and-braces: clean up any blocks the runner did create.
    const blocks = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycle!.id));
    if (blocks.length > 0) {
      await db
        .delete(timeBlockParticipants)
        .where(eq(timeBlockParticipants.timeBlockId, blocks[0]!.id));
    }
  });
});
