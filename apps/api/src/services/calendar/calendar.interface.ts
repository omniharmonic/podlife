/**
 * CalendarProvider interface (per arch § 6.1).
 *
 * All providers receive the encrypted CalendarConnectionRow; they handle
 * decrypting and refreshing tokens internally.
 */
import type { CalendarConnectionRow } from '../../db/schema.js';

export interface FreeBusyWindow {
  start: Date;
  end: Date;
}

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[];
}

export interface CalendarProvider {
  getFreeBusy(
    connection: CalendarConnectionRow,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<FreeBusyWindow[]>;

  createEvent(connection: CalendarConnectionRow, event: CalendarEvent): Promise<string>;

  /**
   * Patch an existing event. Only fields present in `patch` are updated;
   * unspecified fields are left untouched on the provider side.
   */
  updateEvent(
    connection: CalendarConnectionRow,
    eventId: string,
    patch: Partial<CalendarEvent>,
  ): Promise<void>;

  deleteEvent(connection: CalendarConnectionRow, eventId: string): Promise<void>;

  refreshToken(connection: CalendarConnectionRow): Promise<CalendarConnectionRow>;
}

export type ProviderName = 'google' | 'icloud' | 'outlook';
