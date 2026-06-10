import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  reshuffleRequestSchema,
  respondToProposalSchema,
  runCycleSchema,
} from '@pod-life/shared';
import { db } from '../../db/index.js';
import { isNotNull } from 'drizzle-orm';
import {
  auditLog,
  persons,
  podMembers,
  schedulingCycles,
  timeBlockParticipants,
  timeBlocks,
} from '../../db/schema.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { runWithServiceContext } from '../../db/rls.js';
import { processCycleJob, triggerCycle } from './cycle.manager.js';
import { send as notify } from '../../services/notification/notification.service.js';
import {
  pushHoldEventForParticipant,
  cancelEventForParticipant,
  confirmEventsForBlock,
} from '../../services/calendar/calendar.writer.js';
import { logger } from '../../lib/logger.js';

export const scheduleRoutes = new Hono();

scheduleRoutes.post('/run', zValidator('json', runCycleSchema), async (c) => {
  const me = c.get('person');
  const data = c.req.valid('json');
  // If a pod cycle is requested, the caller must be a member of that pod.
  // Without this check a non-member could trigger a cycle over a pod they
  // aren't in, consuming its members' availability and notifying them (H2).
  if (data.podId) {
    const membership = await db
      .select({ podId: podMembers.podId })
      .from(podMembers)
      .where(
        and(
          eq(podMembers.podId, data.podId),
          eq(podMembers.personId, me.id),
          isNotNull(podMembers.joinedAt),
        ),
      )
      .limit(1);
    if (membership.length === 0) {
      throw new NotFoundError('Pod not found');
    }
  }
  const out = await triggerCycle({
    personId: me.id,
    triggerType: 'manual',
    podId: data.podId,
    horizonStart: data.horizonStart ? new Date(data.horizonStart) : undefined,
    horizonEnd: data.horizonEnd ? new Date(data.horizonEnd) : undefined,
  });
  return c.json(out);
});

scheduleRoutes.get('/proposals', async (c) => {
  const me = c.get('person');
  // Time blocks where I'm a participant and status is proposed/accepted.
  const myBlocks = await db
    .select({ tb: timeBlocks, part: timeBlockParticipants })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, me.id),
        inArray(timeBlocks.status, ['proposed', 'accepted'] as const),
      ),
    );

  // Pull satisfaction from the most recent cycle this person is in. The
  // calendar header + per-partner rings consume this. Privacy: filter to
  // only this person's row before returning.
  const cycleIds = [...new Set(myBlocks.map((b) => b.tb.cycleId))];
  let satisfaction: unknown[] = [];
  let reviewWindowEnd: string | null = null;
  if (cycleIds.length > 0) {
    const cycles = await db
      .select()
      .from(schedulingCycles)
      .where(inArray(schedulingCycles.id, cycleIds))
      .orderBy(desc(schedulingCycles.createdAt))
      .limit(1);
    const c0 = cycles[0];
    if (c0?.satisfactionReport) {
      const all = c0.satisfactionReport as Array<{ person_id: string }>;
      satisfaction = all.filter((s) => s.person_id === me.id);
    }
    reviewWindowEnd = c0?.reviewWindowEnd?.toISOString() ?? null;
  }

  return c.json({
    proposals: myBlocks.map(({ tb, part }) => ({
      id: tb.id,
      cycleId: tb.cycleId,
      eventType: tb.eventType,
      eventLabel: tb.eventLabel,
      startTime: tb.startTime.toISOString(),
      endTime: tb.endTime.toISOString(),
      status: tb.status,
      myResponse: part.response,
      partnershipId: tb.partnershipId,
      sourcePodId: tb.sourcePodId,
      satisfactionContribution: tb.satisfactionContribution ?? {},
    })),
    satisfaction,
    reviewWindowEnd,
  });
});

scheduleRoutes.get('/cycles/:id', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(schedulingCycles)
    .where(eq(schedulingCycles.id, id))
    .limit(1);
  const cycle = rows[0];
  if (!cycle) throw new NotFoundError('Cycle not found');
  if (!cycle.personIds.includes(me.id)) throw new ForbiddenError('Not part of this cycle');
  const blocks = await db
    .select()
    .from(timeBlocks)
    .where(eq(timeBlocks.cycleId, id));
  // Filter to only blocks I'm a participant in (privacy).
  const myBlockIds = new Set(
    (await db
      .select({ id: timeBlockParticipants.timeBlockId })
      .from(timeBlockParticipants)
      .where(
        and(
          eq(timeBlockParticipants.personId, me.id),
          inArray(
            timeBlockParticipants.timeBlockId,
            blocks.map((b) => b.id),
          ),
        ),
      )).map((b) => b.id),
  );
  return c.json({
    cycle: {
      id: cycle.id,
      status: cycle.status,
      horizonStart: cycle.horizonStart.toISOString(),
      horizonEnd: cycle.horizonEnd.toISOString(),
      triggerType: cycle.triggerType,
      reviewWindowEnd: cycle.reviewWindowEnd?.toISOString() ?? null,
      satisfactionReport: cycle.satisfactionReport,
      infeasibilityNotes: cycle.infeasibilityNotes,
    },
    blocks: blocks
      .filter((b) => myBlockIds.has(b.id))
      .map((b) => ({
        id: b.id,
        eventType: b.eventType,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        status: b.status,
      })),
  });
});

scheduleRoutes.get('/current', async (c) => {
  const me = c.get('person');
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const myBlocks = await db
    .select({ tb: timeBlocks })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, me.id),
        eq(timeBlocks.status, 'locked'),
        gte(timeBlocks.endTime, now),
        lte(timeBlocks.startTime, horizon),
      ),
    );
  return c.json({
    blocks: myBlocks.map(({ tb }) => ({
      id: tb.id,
      eventType: tb.eventType,
      startTime: tb.startTime.toISOString(),
      endTime: tb.endTime.toISOString(),
    })),
  });
});

scheduleRoutes.post(
  '/proposals/:id/respond',
  zValidator('json', respondToProposalSchema),
  async (c) => {
    const me = c.get('person');
    const id = c.req.param('id');
    const { response, changeNote } = c.req.valid('json');

    // Verify I'm a participant.
    const partRows = await db
      .select()
      .from(timeBlockParticipants)
      .where(
        and(
          eq(timeBlockParticipants.timeBlockId, id),
          eq(timeBlockParticipants.personId, me.id),
        ),
      )
      .limit(1);
    if (!partRows[0]) throw new NotFoundError('Proposal not found');

    await db
      .update(timeBlockParticipants)
      .set({
        response,
        changeNote: changeNote ?? null,
        respondedAt: new Date(),
      })
      .where(
        and(
          eq(timeBlockParticipants.timeBlockId, id),
          eq(timeBlockParticipants.personId, me.id),
        ),
      );

    // Calendar lifecycle:
    //   accept   → push HOLD event to this participant's calendar
    //   decline  → delete the event we previously pushed (if any)
    // Both calls are best-effort — failures are logged and do not break
    // the user-facing accept/decline flow. The cron sweep retries.
    const blockRows = await db.select().from(timeBlocks).where(eq(timeBlocks.id, id)).limit(1);
    const block = blockRows[0];

    if (response === 'accepted' && block) {
      await pushHoldEventForParticipant(block, me.id);
    } else if (response === 'declined') {
      await cancelEventForParticipant(id, me.id);
      // Flip the block's status so parallel cycles can stop treating it
      // as a soft claim. (See loadCommittedBlocks in cycle.manager.ts —
      // declined blocks are excluded from the busy set so the next cycle
      // can re-propose into the freed window.)
      if (block && block.status !== 'declined' && block.status !== 'reshuffled') {
        await db
          .update(timeBlocks)
          .set({ status: 'declined' })
          .where(eq(timeBlocks.id, id));
      }
    }

    // If all participants accepted, transition through `accepted` while we
    // attempt to drop the HOLD prefix from each participant's calendar event.
    // Only advance to `locked` when every PATCH succeeds — failures leave the
    // block in `accepted` so the auto-lock cron can retry on the next sweep.
    // (Going straight to `locked` here would orphan failed confirms: the cron
    // sweeps `accepted`, not `locked`.)
    let allCalendarOk = true;
    if (response === 'accepted' && block) {
      const all = await db
        .select()
        .from(timeBlockParticipants)
        .where(eq(timeBlockParticipants.timeBlockId, id));
      if (all.every((p) => p.response === 'accepted')) {
        await db.update(timeBlocks).set({ status: 'accepted' }).where(eq(timeBlocks.id, id));
        allCalendarOk = await confirmEventsForBlock(block);
        if (allCalendarOk) {
          await db.update(timeBlocks).set({ status: 'locked' }).where(eq(timeBlocks.id, id));
        }
      }
    }

    await db.insert(auditLog).values({
      personId: me.id,
      action: 'proposal.respond',
      resourceType: 'time_block',
      resourceId: id,
      metadata: { response },
    });

    // `calendarWarning` is set when every participant accepted but at least
    // one calendar PATCH failed — the auto-lock cron will retry, but the
    // user-facing UI can show a soft warning so they aren't surprised that
    // the HOLD prefix lingers for a few minutes.
    return c.json({ ok: true, calendarWarning: !allCalendarOk });
  },
);

scheduleRoutes.post(
  '/reshuffle',
  zValidator('json', reshuffleRequestSchema),
  async (c) => {
    const me = c.get('person');
    const data = c.req.valid('json');
    // Authorization: only a participant of the block may reshuffle it.
    // Without this, any authenticated user could cancel/reshuffle another
    // pod's confirmed block by guessing its id (H1). (RLS also blocks the
    // UPDATE below, but we check explicitly for a clean 404 and defense in
    // depth.) Mirror the respond endpoint's participation check.
    const mine = await db
      .select({ personId: timeBlockParticipants.personId })
      .from(timeBlockParticipants)
      .where(
        and(
          eq(timeBlockParticipants.timeBlockId, data.blockId),
          eq(timeBlockParticipants.personId, me.id),
        ),
      )
      .limit(1);
    if (mine.length === 0) throw new NotFoundError('Block not found');
    // Mark the original block as reshuffled, then trigger a fresh cycle.
    const [updated] = await db
      .update(timeBlocks)
      .set({ status: 'reshuffled' })
      .where(eq(timeBlocks.id, data.blockId))
      .returning();
    if (!updated) throw new NotFoundError('Block not found');
    await db.insert(auditLog).values({
      personId: me.id,
      action: 'schedule.reshuffle',
      resourceType: 'time_block',
      resourceId: data.blockId,
      metadata: { reason: data.reason },
    });

    // Notify the OTHER participants of the affected block that a reshuffle
    // is in progress. Best-effort — never fails the reshuffle itself.
    try {
      const otherParts = await db
        .select({ personId: timeBlockParticipants.personId })
        .from(timeBlockParticipants)
        .where(eq(timeBlockParticipants.timeBlockId, data.blockId));
      const reshufflerRow = await db
        .select({ displayName: persons.displayName })
        .from(persons)
        .where(eq(persons.id, me.id))
        .limit(1);
      const reshufflerName = reshufflerRow[0]?.displayName ?? 'A partner';
      await Promise.all(
        otherParts
          .filter((p) => p.personId !== me.id)
          .map((p) =>
            notify(p.personId, {
              title: 'Schedule reshuffle requested',
              body: `${reshufflerName} requested a reshuffle. A new proposal is on its way.`,
              actionUrl: '/schedule/review',
              channels: ['in_app'],
            }),
          ),
      );
    } catch (err) {
      logger.warn('reshuffle notification failed', {
        blockId: data.blockId,
        err: (err as Error).message,
      });
    }

    const out = await triggerCycle({
      personId: me.id,
      triggerType: 'reshuffle',
    });
    return c.json(out);
  },
);

// Allow synchronous in-process processing for tests.
scheduleRoutes.post('/_test/run-now/:cycleId', async (c) => {
  if (process.env.NODE_ENV !== 'test') throw new ForbiddenError();
  const cycleId = c.req.param('cycleId');
  // Mirror the real worker path: the cycle job runs across many persons and
  // therefore under service (RLS-bypass) context, not the requester's context.
  const out = await runWithServiceContext(() => processCycleJob({ cycleId }));
  return c.json(out);
});
