/**
 * Google Calendar provider — fetch-based against the v3 REST API + OAuth.
 * No third-party SDK; fewer moving parts.
 *
 * Scopes:
 *  - https://www.googleapis.com/auth/calendar.events    (read/write events)
 *  - https://www.googleapis.com/auth/calendar.freebusy  (free/busy)
 */
import { eq } from 'drizzle-orm';
import { config } from '../../lib/config.ts';
import { db } from '../../db/index.ts';
import { calendarConnections, type CalendarConnectionRow } from '../../db/schema.ts';
import { decrypt, encrypt } from '../encryption/vault.ts';
import { AppError } from '../../lib/errors.ts';
import type {
  CalendarEvent,
  CalendarProvider,
  FreeBusyWindow,
} from './calendar.interface.ts';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function redirectUri(): string {
  return `${config.appUrl}/auth/calendar/google/callback`;
}

export function getAuthUrl(state: string): string {
  if (!config.google.enabled) {
    throw new AppError('GOOGLE_DISABLED', 'Google Calendar OAuth not configured', 501);
  }
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new AppError('GOOGLE_OAUTH_FAILED', 'Google OAuth token exchange failed', 502, {
      internalMessage: await res.text(),
    });
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function persistConnection(
  personId: string,
  tokenResponse: GoogleTokenResponse,
): Promise<CalendarConnectionRow> {
  const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
  const encryptedAccess = encrypt(tokenResponse.access_token);
  const encryptedRefresh = tokenResponse.refresh_token
    ? encrypt(tokenResponse.refresh_token)
    : null;

  // Upsert (one google connection per person).
  const existing = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.personId, personId))
    .limit(1);

  if (existing[0] && existing[0].provider === 'google') {
    const [row] = await db
      .update(calendarConnections)
      .set({
        encryptedAccessToken: encryptedAccess,
        ...(encryptedRefresh ? { encryptedRefreshToken: encryptedRefresh } : {}),
        tokenExpiresAt,
        scopes: SCOPES,
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing[0].id))
      .returning();
    if (!row) throw new Error('Failed to update calendar connection');
    return row;
  }
  const [row] = await db
    .insert(calendarConnections)
    .values({
      personId,
      provider: 'google',
      encryptedAccessToken: encryptedAccess,
      encryptedRefreshToken: encryptedRefresh,
      tokenExpiresAt,
      scopes: SCOPES,
    })
    .returning();
  if (!row) throw new Error('Failed to create calendar connection');
  return row;
}

async function ensureFreshToken(
  connection: CalendarConnectionRow,
): Promise<{ accessToken: string; row: CalendarConnectionRow }> {
  const expiresAt = connection.tokenExpiresAt?.getTime() ?? 0;
  // Refresh if within 60s of expiry.
  if (expiresAt > Date.now() + 60_000) {
    return { accessToken: decrypt(connection.encryptedAccessToken), row: connection };
  }
  if (!connection.encryptedRefreshToken) {
    throw new AppError(
      'CALENDAR_REAUTH_REQUIRED',
      'Calendar token expired; please reconnect',
      401,
    );
  }
  const refreshToken = decrypt(connection.encryptedRefreshToken);
  const body = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new AppError('CALENDAR_REFRESH_FAILED', 'Failed to refresh calendar token', 502);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
  const encryptedAccess = encrypt(data.access_token);
  const [updated] = await db
    .update(calendarConnections)
    .set({
      encryptedAccessToken: encryptedAccess,
      tokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, connection.id))
    .returning();
  if (!updated) throw new Error('Failed to persist refreshed token');
  return { accessToken: data.access_token, row: updated };
}

async function googleFetch<T>(
  connection: CalendarConnectionRow,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const { accessToken } = await ensureFreshToken(connection);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new AppError('GOOGLE_API_ERROR', `Google API error: ${res.status}`, 502, {
      internalMessage: await res.text(),
    });
  }
  return (await res.json()) as T;
}

export const googleProvider: CalendarProvider = {
  async getFreeBusy(connection, rangeStart, rangeEnd): Promise<FreeBusyWindow[]> {
    const data = await googleFetch<{
      calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
    }>(connection, 'https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        items: [{ id: connection.calendarId ?? 'primary' }],
      }),
    });
    const cal = Object.values(data.calendars)[0];
    return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  },

  async createEvent(connection, event: CalendarEvent): Promise<string> {
    const data = await googleFetch<{ id: string }>(
      connection,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        connection.calendarId ?? 'primary',
      )}/events`,
      {
        method: 'POST',
        body: JSON.stringify({
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start.toISOString() },
          end: { dateTime: event.end.toISOString() },
          attendees: event.attendees?.map((email) => ({ email })),
        }),
      },
    );
    return data.id;
  },

  async deleteEvent(connection, eventId: string): Promise<void> {
    const { accessToken } = await ensureFreshToken(connection);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        connection.calendarId ?? 'primary',
      )}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      throw new AppError('GOOGLE_API_ERROR', 'Failed to delete event', 502);
    }
  },

  async refreshToken(connection): Promise<CalendarConnectionRow> {
    const { row } = await ensureFreshToken(connection);
    return row;
  },
};
