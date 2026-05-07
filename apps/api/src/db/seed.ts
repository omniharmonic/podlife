/**
 * Idempotent seed: ensures the 5 system event types exist.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { DEFAULT_EVENT_TYPES } from '@pod-life/shared';
import { db, shutdownDb } from './index.js';
import { eventTypes } from './schema.js';

export async function runSeed(): Promise<void> {
  for (const et of DEFAULT_EVENT_TYPES) {
    const existing = await db
      .select({ id: eventTypes.id })
      .from(eventTypes)
      .where(and(eq(eventTypes.label, et.label), eq(eventTypes.isSystem, true), isNull(eventTypes.podId)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(eventTypes).values({
        label: et.label,
        emoji: et.emoji,
        defaultDurationHours: String(et.durationHours),
        blocksNextMorning: et.blocksNextMorning,
        isSystem: true,
        sortOrder: et.sortOrder,
      });
    }
  }
  // eslint-disable-next-line no-console
  console.log('[seed] event types ready');
}

// Allow running directly: `tsx src/db/seed.ts`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runSeed()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed] failed:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await shutdownDb();
    });
}
