/**
 * Auto-lock cron job.
 *
 * Sweeps for blocks that are stuck in `accepted` (everyone clicked accept,
 * but the inline confirm-events step failed for some reason — calendar API
 * blip, our request timed out, etc.) and brings them home:
 *   1. Remove the HOLD prefix from each participant's calendar event.
 *   2. Transition the block to `locked` (only if every PATCH succeeded).
 *
 * Idempotent — safe to re-run. Calendar PATCHes are no-ops when the title is
 * already correct. confirmEventsForBlock returns false when any participant's
 * PATCH failed, in which case the block stays in `accepted` for the next
 * sweep to retry.
 *
 * Wired to /api/cron/auto-lock via vercel.json (runs daily on Hobby; happy
 * to bump to hourly if/when you upgrade to Pro).
 */
import { eq } from 'drizzle-orm';
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
      const ok = await confirmEventsForBlock(block);
      if (ok) {
        await db.update(timeBlocks).set({ status: 'locked' }).where(eq(timeBlocks.id, block.id));
        logger.info('auto-lock: confirmed + locked', { blockId: block.id });
      } else {
        logger.info('auto-lock: partial confirm, will retry next sweep', {
          blockId: block.id,
        });
      }
    } catch (err) {
      logger.warn('auto-lock: failed to confirm', {
        blockId: block.id,
        err: (err as Error).message,
      });
    }
  }

  // TODO (product): handle blocks that have a partial-accept past their
  // review window. The intended behavior is up for discussion — should
  // declined / never-responded blocks be silently dropped, or surface as
  // an unresolved item? Leaving as a no-op until that's decided.
  void now;

  logger.info('auto-lock complete', { acceptedSwept: accepted.length });
}
