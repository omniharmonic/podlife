/**
 * Manual availability fallback. Reads from the manual_availability table.
 * Treats every stored window as a "free" window. (Inverted by the
 * aggregator into busy windows internally.)
 */
import { and, eq, gte, lte, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { manualAvailability } from '../../db/schema.js';

export interface AvailabilityWindow {
  start: Date;
  end: Date;
}

export async function listManualWindows(
  personId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<AvailabilityWindow[]> {
  const rows = await db
    .select()
    .from(manualAvailability)
    .where(
      and(
        eq(manualAvailability.personId, personId),
        // any window that overlaps [rangeStart, rangeEnd]
        or(
          and(gte(manualAvailability.startTime, rangeStart), lte(manualAvailability.startTime, rangeEnd)),
          and(gte(manualAvailability.endTime, rangeStart), lte(manualAvailability.endTime, rangeEnd)),
          and(lte(manualAvailability.startTime, rangeStart), gte(manualAvailability.endTime, rangeEnd)),
        ),
      ),
    );
  return rows.map((r) => ({ start: r.startTime, end: r.endTime }));
}

export async function setManualWindows(
  personId: string,
  windows: AvailabilityWindow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(manualAvailability).where(eq(manualAvailability.personId, personId));
    if (windows.length > 0) {
      await tx.insert(manualAvailability).values(
        windows.map((w) => ({
          personId,
          startTime: w.start,
          endTime: w.end,
        })),
      );
    }
  });
}
