import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { setManualAvailabilitySchema } from '@pod-life/shared';
import { db } from '../../db/index.js';
import { calendarConnections } from '../../db/schema.js';
import { redis, redisFor } from '../../lib/redis.js';
import { config } from '../../lib/config.js';
import { AppError, AuthError, NotFoundError } from '../../lib/errors.js';
import {
  exchangeCode,
  getAuthUrl,
  persistConnection,
} from '../../services/calendar/google.provider.js';
import {
  getPersonFreeWindows,
  invalidatePersonAvailabilityCache,
} from '../../services/calendar/calendar.aggregator.js';
import { setManualWindows } from '../../services/calendar/manual.provider.js';
import { resolveSession } from '../auth/login-code.service.js';

// Authenticated /api/me/* routes ------------------------------------
export const calendarRoutes = new Hono();

calendarRoutes.get('/me/availability', async (c) => {
  const me = c.get('person');
  const start = c.req.query('start');
  const end = c.req.query('end');
  if (!start || !end) throw new AppError('BAD_REQUEST', 'start and end required', 400);
  const startDate = new Date(start);
  const endDate = new Date(end);
  // Guard against unparseable input (e.g. a `+` decoded to a space). Without
  // this the Invalid Date propagates and a downstream toISOString() throws a
  // 500 instead of a clean client error.
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new AppError('BAD_REQUEST', 'start and end must be valid ISO-8601 timestamps', 400);
  }
  if (endDate <= startDate) {
    throw new AppError('BAD_REQUEST', 'end must be after start', 400);
  }
  const free = await getPersonFreeWindows(me.id, startDate, endDate);
  return c.json({
    windows: free.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
  });
});

calendarRoutes.post(
  '/me/availability/manual',
  zValidator('json', setManualAvailabilitySchema),
  async (c) => {
    const me = c.get('person');
    const { windows } = c.req.valid('json');
    await setManualWindows(
      me.id,
      windows.map((w) => ({ start: new Date(w.start), end: new Date(w.end) })),
    );
    await invalidatePersonAvailabilityCache(me.id);
    return c.json({ ok: true, count: windows.length });
  },
);

calendarRoutes.get('/me/calendars', async (c) => {
  const me = c.get('person');
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.personId, me.id));
  return c.json({
    connections: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      syncError: r.syncError,
      scopes: r.scopes,
    })),
  });
});

calendarRoutes.delete('/me/calendars/:id', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const found = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, id))
    .limit(1);
  if (!found[0] || found[0].personId !== me.id) throw new NotFoundError('Connection not found');
  await db.delete(calendarConnections).where(eq(calendarConnections.id, id));
  await invalidatePersonAvailabilityCache(me.id);
  return c.json({ ok: true });
});

// Public OAuth callback routes -------------------------------------
export const calendarOAuthRoutes = new Hono();

const stateKey = redisFor('cal-state');

calendarOAuthRoutes.get('/google', async (c) => {
  // Caller must pass session token via ?token=… so we know the person to
  // associate the OAuth state with. (We can't use the Authorization header
  // because the OAuth flow involves redirects that drop headers.)
  const sessionToken = c.req.query('token');
  if (!sessionToken) throw new AuthError('Missing token query parameter');
  const person = await resolveSession(sessionToken);
  if (!person) throw new AuthError('Invalid or expired session');
  if (!config.google.enabled) {
    throw new AppError('GOOGLE_DISABLED', 'Google Calendar OAuth not configured', 501);
  }
  const state = nanoid(32);
  await redis.set(stateKey(state), person.id, 600);
  return c.redirect(getAuthUrl(state));
});

calendarOAuthRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) throw new AppError('BAD_REQUEST', 'Missing code or state', 400);
  const personId = await redis.get(stateKey(state));
  if (!personId) throw new AppError('STATE_INVALID', 'Invalid OAuth state', 400);
  await redis.del(stateKey(state));

  const tokens = await exchangeCode(code);
  await persistConnection(personId, tokens);
  // Bust the availability cache: any rows computed from manual/blocked-windows
  // before the connection landed are now stale. Without this, the next cycle
  // would silently use the cached pre-connection free windows for up to an
  // hour, producing wrong proposals or 'no overlap' false negatives.
  await invalidatePersonAvailabilityCache(personId);
  return c.redirect(`${config.frontendUrl}/settings/calendars?connected=google`);
});
