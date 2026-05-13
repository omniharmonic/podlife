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
 *        Returns true only if every push succeeded; the caller uses that
 *        signal to decide whether to advance the block to `locked` or keep
 *        it in `accepted` for the auto-lock cron to retry.
 *
 *   3. Participant declines (or block is reshuffled / cancelled)
 *      → cancelEventForParticipant(): DELETE the event and clear the stored
 *        external_event_id.
 *
 * Provider calls are isolated in try/catch so a transient calendar failure
 * does not break the user-facing accept/decline flow — but failures are
 * reported back to the caller (via the boolean return on
 * confirmEventsForBlock) so the block stays in `accepted` and the auto-lock
 * cron can retry the confirm pass.
 *
 * Event titles include the partner name (for partnership blocks) or the pod
 * name (for pod blocks). The participant's own calendar is treated as their
 * own private space — see CLAUDE.md "Privacy Model" for the rationale and
 * the trade-off when a calendar is shared with someone outside the pod.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  calendarConnections,
  partnerships,
  persons,
  pods,
  timeBlockParticipants,
  type TimeBlockRow,
  type CalendarConnectionRow,
} from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { googleProvider } from './google.provider.js';
import type { CalendarEvent, CalendarProvider } from './calendar.interface.js';

const HOLD_PREFIX = 'HOLD · ';

/**
 * Build the human-facing event title for one participant viewing one block.
 *
 * Partnership blocks → "Date Night with Sam"
 * Pod blocks         → "Pod Gathering with Home Base"
 * Neither            → fall back to the bare event type ("Solo Time")
 *
 * The participant's own calendar is treated as theirs to inspect — including
 * the partner / pod name is the whole point. The lookup runs per-call rather
 * than being memoized; calendar writes are infrequent and the cost is one
 * indexed read.
 */
export async function buildTitleSuffix(
  block: TimeBlockRow,
  viewerPersonId: string,
): Promise<string> {
  if (block.partnershipId) {
    const rows = await db
      .select({
        personAId: partnerships.personAId,
        personBId: partnerships.personBId,
      })
      .from(partnerships)
      .where(eq(partnerships.id, block.partnershipId))
      .limit(1);
    const p = rows[0];
    if (p) {
      const otherId = p.personAId === viewerPersonId ? p.personBId : p.personAId;
      const nameRows = await db
        .select({ displayName: persons.displayName })
        .from(persons)
        .where(eq(persons.id, otherId))
        .limit(1);
      const name = nameRows[0]?.displayName;
      if (name) return ` with ${name}`;
    }
  }
  if (block.sourcePodId) {
    const rows = await db
      .select({ name: pods.name })
      .from(pods)
      .where(eq(pods.id, block.sourcePodId))
      .limit(1);
    const name = rows[0]?.name;
    if (name) return ` with ${name}`;
  }
  return '';
}

function holdSummary(eventType: string, titleSuffix: string): string {
  return `${HOLD_PREFIX}${eventType}${titleSuffix}`;
}

function confirmedSummary(eventType: string, titleSuffix: string): string {
  return `${eventType}${titleSuffix}`;
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
 *
 * Idempotent: if an external_event_id is already stored for this (block,
 * person) pair, we skip the push. Without this guard, repeated clicks of
 * Accept (or accept→re-accept-without-decline) duplicate calendar events.
 * The decline path clears external_event_id, so accept-after-decline still
 * pushes a fresh event.
 */
export async function pushHoldEventForParticipant(
  block: TimeBlockRow,
  personId: string,
): Promise<void> {
  const existingRows = await db
    .select({ externalEventId: timeBlockParticipants.externalEventId })
    .from(timeBlockParticipants)
    .where(
      and(
        eq(timeBlockParticipants.timeBlockId, block.id),
        eq(timeBlockParticipants.personId, personId),
      ),
    )
    .limit(1);
  if (existingRows[0]?.externalEventId) {
    logger.info('skipping duplicate HOLD push (already pushed)', {
      blockId: block.id,
      personId,
      eventId: existingRows[0].externalEventId,
    });
    return;
  }

  const connection = await firstActiveConnection(personId);
  if (!connection) return;

  const provider = providerFor(connection.provider);
  if (!provider) return;

  const titleSuffix = await buildTitleSuffix(block, personId);
  const event: CalendarEvent = {
    summary: holdSummary(block.eventType ?? 'Pod Life event', titleSuffix),
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
 * side effect.
 *
 * Returns `true` only when every participant's event was confirmed (or had
 * no event to confirm). A `false` return tells the caller to leave the block
 * in `accepted` so the auto-lock cron can retry the confirm pass on the
 * next sweep.
 */
export async function confirmEventsForBlock(block: TimeBlockRow): Promise<boolean> {
  const participants = await db
    .select()
    .from(timeBlockParticipants)
    .where(eq(timeBlockParticipants.timeBlockId, block.id));

  let allOk = true;
  for (const part of participants) {
    if (!part.externalEventId || !part.externalEventProvider) continue;
    const connection = await firstActiveConnection(part.personId, part.externalEventProvider);
    if (!connection) continue;
    const provider = providerFor(connection.provider);
    if (!provider) continue;

    const titleSuffix = await buildTitleSuffix(block, part.personId);
    try {
      await provider.updateEvent(connection, part.externalEventId, {
        summary: confirmedSummary(block.eventType ?? 'Pod Life event', titleSuffix),
      });
      logger.info('calendar event confirmed (HOLD removed)', {
        blockId: block.id,
        personId: part.personId,
        eventId: part.externalEventId,
      });
    } catch (err) {
      allOk = false;
      logger.warn('calendar event confirm failed', {
        blockId: block.id,
        personId: part.personId,
        err: (err as Error).message,
      });
    }
  }
  return allOk;
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
