/**
 * Calendar write-back lifecycle helpers.
 *
 * The intended flow:
 *
 *   1. Participant accepts a proposed time block
 *      → pushHoldEventForParticipant(): create a HOLD event on their calendar
 *        and store the returned event id on time_block_participants.
 *
 *   2. All participants accept (block status flips to `accepted`)
 *      → confirmEventsForBlock(): for every participant who has an event
 *        already pushed, PATCH the event to remove the HOLD prefix.
 *      → block status moves to `locked` (atomically by the caller).
 *
 *   3. Participant declines (or block is reshuffled / cancelled)
 *      → cancelEventForParticipant(): DELETE the event and clear the stored
 *        external_event_id.
 *
 * All provider calls are best-effort and isolated in try/catch so a failure
 * to push or update does not break the user-facing accept/decline flow.
 * The cron sweep (jobs/auto-lock.ts) re-runs step 2 over `accepted` blocks
 * to catch any inline failures.
 *
 * Event titles never reveal partner names — only the event_type is used —
 * to honor the privacy invariants in CLAUDE.md.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  calendarConnections,
  timeBlockParticipants,
  type TimeBlockRow,
  type CalendarConnectionRow,
} from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { googleProvider } from './google.provider.js';
import type { CalendarEvent, CalendarProvider } from './calendar.interface.js';

const HOLD_PREFIX = 'HOLD · ';

function holdSummary(eventType: string): string {
  return `${HOLD_PREFIX}${eventType}`;
}

function confirmedSummary(eventType: string): string {
  return eventType;
}

function providerFor(name: string): CalendarProvider | null {
  if (name === 'google') return googleProvider;
  // microsoft / outlook would slot in here when implemented.
  return null;
}

/**
 * Push a HOLD-prefixed event to the participant's connected calendar.
 * No-op when the participant has no connection. Errors are swallowed and
 * logged — the caller's accept flow must not block on calendar writes.
 */
export async function pushHoldEventForParticipant(
  block: TimeBlockRow,
  personId: string,
): Promise<void> {
  const connection = await firstActiveConnection(personId);
  if (!connection) return;

  const provider = providerFor(connection.provider);
  if (!provider) return;

  const event: CalendarEvent = {
    summary: holdSummary(block.eventType ?? 'Pod Life event'),
    description:
      "Tentatively held by Pod Life. The HOLD prefix will drop once everyone has accepted. " +
      "If plans change, decline in the app and we'll remove this from your calendar.",
    start: block.startTime,
    end: block.endTime,
  };

  try {
    const eventId = await provider.createEvent(connection, event);
    await db
      .update(timeBlockParticipants)
      .set({ externalEventId: eventId, externalEventProvider: connection.provider })
      .where(
        and(
          eq(timeBlockParticipants.timeBlockId, block.id),
          eq(timeBlockParticipants.personId, personId),
        ),
      );
    logger.info('calendar HOLD event created', {
      blockId: block.id,
      personId,
      provider: connection.provider,
      eventId,
    });
  } catch (err) {
    logger.warn('calendar HOLD event push failed', {
      blockId: block.id,
      personId,
      provider: connection.provider,
      err: (err as Error).message,
    });
  }
}

/**
 * Drop the HOLD prefix from every participant's calendar event for a block.
 * Idempotent — already-confirmed events PATCH back to the same value with no
 * side effect. Used by both the inline all-accepted path and the cron sweep.
 */
export async function confirmEventsForBlock(block: TimeBlockRow): Promise<void> {
  const participants = await db
    .select()
    .from(timeBlockParticipants)
    .where(eq(timeBlockParticipants.timeBlockId, block.id));

  for (const part of participants) {
    if (!part.externalEventId || !part.externalEventProvider) continue;
    const connection = await firstActiveConnection(part.personId, part.externalEventProvider);
    if (!connection) continue;
    const provider = providerFor(connection.provider);
    if (!provider) continue;

    try {
      await provider.updateEvent(connection, part.externalEventId, {
        summary: confirmedSummary(block.eventType ?? 'Pod Life event'),
      });
      logger.info('calendar event confirmed (HOLD removed)', {
        blockId: block.id,
        personId: part.personId,
        eventId: part.externalEventId,
      });
    } catch (err) {
      logger.warn('calendar event confirm failed', {
        blockId: block.id,
        personId: part.personId,
        err: (err as Error).message,
      });
    }
  }
}

/**
 * Delete the participant's calendar event when they decline (or the block
 * gets reshuffled/cancelled). Clears the external_event_id so re-acceptance
 * works cleanly.
 */
export async function cancelEventForParticipant(
  blockId: string,
  personId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(timeBlockParticipants)
    .where(
      and(
        eq(timeBlockParticipants.timeBlockId, blockId),
        eq(timeBlockParticipants.personId, personId),
      ),
    )
    .limit(1);
  const part = rows[0];
  if (!part?.externalEventId || !part.externalEventProvider) return;

  const connection = await firstActiveConnection(personId, part.externalEventProvider);
  if (connection) {
    const provider = providerFor(connection.provider);
    if (provider) {
      try {
        await provider.deleteEvent(connection, part.externalEventId);
      } catch (err) {
        logger.warn('calendar event delete failed', {
          blockId,
          personId,
          err: (err as Error).message,
        });
      }
    }
  }
  await db
    .update(timeBlockParticipants)
    .set({ externalEventId: null, externalEventProvider: null })
    .where(
      and(
        eq(timeBlockParticipants.timeBlockId, blockId),
        eq(timeBlockParticipants.personId, personId),
      ),
    );
}

async function firstActiveConnection(
  personId: string,
  preferProvider?: string,
): Promise<CalendarConnectionRow | null> {
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.personId, personId));
  if (rows.length === 0) return null;
  if (preferProvider) {
    const m = rows.find((r) => r.provider === preferProvider);
    if (m) return m;
  }
  // Prefer google as the only implemented provider.
  return rows.find((r) => r.provider === 'google') ?? rows[0]!;
}
