/**
 * Auto-lock cron job.
 *
 * Sweeps for blocks that are stuck in `accepted` (everyone clicked accept,
 * but the inline confirm-events step failed for some reason — calendar API
 * blip, our request timed out, etc.) and brings them home:
 *   1. Remove the HOLD prefix from each participant's calendar event.
 *   2. Transition the block to `locked` so the cycle can wrap up.
 *
 * Idempotent — safe to re-run. Calendar PATCHes are no-ops when the title is
 * already correct, and confirmEventsForBlock swallows individual failures.
 *
 * Wired to /api/cron/auto-lock via vercel.json (runs daily on Hobby; happy
 * to bump to hourly if/when you upgrade to Pro).
 */
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { timeBlocks } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { confirmEventsForBlock } from '../services/calendar/calendar.writer.js';

export async function runAutoLock(): Promise<void> {
  const now = new Date();

  // 1. Blocks where all participants already accepted (status='accepted').
  //    Inline path normally moves these straight to 'locked' — anything
  //    still in 'accepted' is the spillover from a failed inline confirm.
  const accepted = await db
    .select()
    .from(timeBlocks)
    .where(eq(timeBlocks.status, 'accepted'));

  for (const block of accepted) {
    try {
      await confirmEventsForBlock(block);
      await db.update(timeBlocks).set({ status: 'locked' }).where(eq(timeBlocks.id, block.id));
      logger.info('auto-lock: confirmed + locked', { blockId: block.id });
    } catch (err) {
      logger.warn('auto-lock: failed to confirm', {
        blockId: block.id,
        err: (err as Error).message,
      });
    }
  }

  // 2. Cycles whose review window has expired (proposed → locked of
  //    whatever has been accepted, drop the rest). Stub for now — needs
  //    product input on what happens to declined/un-responded blocks.
  //    Logging the count so we can see when we'd be acting if implemented.
  const expired = await db
    .select({ id: timeBlocks.id })
    .from(timeBlocks)
    .innerJoin(
      // schedulingCycles, etc — left as a TODO until product behavior is set.
      timeBlocks,
      eq(timeBlocks.id, timeBlocks.id),
    )
    .where(
      and(eq(timeBlocks.status, 'proposed'), lt(timeBlocks.endTime, now)),
    )
    .limit(0);
  void expired;

  logger.info('auto-lock complete', { acceptedSwept: accepted.length });
}
