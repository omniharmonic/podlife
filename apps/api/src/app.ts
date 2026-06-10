/**
 * Hono application — wires middleware and routes.
 * Per arch § 8.1.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './lib/config.js';
import { db } from './db/index.js';
import { redis } from './lib/redis.js';
import { sql } from 'drizzle-orm';
import { errorHandler } from './middleware/error.middleware.js';
import { rateLimit } from './middleware/rate-limit.middleware.js';
import { requireAuth } from './middleware/auth.middleware.js';
import { rlsContext } from './middleware/rls.middleware.js';
import { privacyScrub } from './middleware/privacy.middleware.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { personsRoutes } from './modules/persons/persons.routes.js';
import { notificationsRoutes } from './modules/persons/notifications.routes.js';
import { partnersRoutes } from './modules/partners/partners.routes.js';
import { podsRoutes } from './modules/pods/pods.routes.js';
import { invitesPublicRoutes, invitesRoutes } from './modules/invites/invites.routes.js';
import { chatRoutes } from './modules/pods/chat.routes.js';
import { notesRoutes } from './modules/pods/notes.routes.js';
import { healthRoutes as podHealthRoutes } from './modules/pods/health.routes.js';
import { calendarRoutes, calendarOAuthRoutes } from './modules/calendar/calendar.routes.js';
import { scheduleRoutes } from './modules/schedule/schedule.routes.js';
import {
  aiPartnerRoutes,
  aiScheduleRoutes,
  featuresRoutes,
} from './modules/ai/ai.routes.js';
import {
  telegramLinkRoutes,
  telegramPodLinkRoutes,
} from './modules/telegram/link.routes.js';
import { telegramWebhookRoutes } from './modules/telegram/telegram.webhook.js';
import { internalRoutes } from './modules/internal/internal.routes.js';
import { cronRoutes } from './modules/internal/cron.routes.js';
import { logger } from './lib/logger.js';

export function buildApp(): Hono {
  const app = new Hono();

  // Cross-cutting middleware --------------------------------------------------
  app.use('*', honoLogger());
  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: config.frontendUrl,
      credentials: true,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use('*', rateLimit());

  app.onError(errorHandler);

  // Public routes -------------------------------------------------------------
  app.get('/health', async (c) => {
    let dbOk = false;
    let redisOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      /* ignore */
    }
    try {
      await redis.ping();
      redisOk = true;
    } catch {
      /* ignore */
    }
    const status = dbOk && redisOk ? 'ok' : 'degraded';
    return c.json({ status, db: dbOk, redis: redisOk });
  });

  app.route('/auth', authRoutes);
  // Calendar OAuth callbacks must be public (the redirect carries no session).
  app.route('/auth/calendar', calendarOAuthRoutes);
  // Telegram webhook is public — secret in URL + secret-token header.
  app.route('/telegram/webhook', telegramWebhookRoutes);
  // QStash job webhooks (signature-verified inside the handler).
  app.route('/internal', internalRoutes);
  // Vercel Cron entry points (Bearer CRON_SECRET inside the handler).
  app.route('/api/cron', cronRoutes);
  // Public invite preview — mounted BEFORE the authed /api group so
  // requireAuth doesn't apply. Only path that matches here is
  // GET /api/invites/:token/preview; everything else under /api/invites
  // (mint, list, accept, revoke) falls through to the authed router below.
  app.route('/api/invites', invitesPublicRoutes);

  // Authenticated routes ------------------------------------------------------
  const api = new Hono();
  api.use('*', requireAuth);
  // RLS context runs right after auth so every downstream `db` query is scoped
  // to the authenticated person at the database layer (second privacy layer).
  api.use('*', rlsContext);
  // Privacy scrub runs AFTER auth so it can identify the requester. It is the
  // third of four privacy defense layers (CLAUDE.md § Privacy Model).
  api.use('*', privacyScrub);
  api.route('/', personsRoutes);
  api.route('/', notificationsRoutes); // /me/notifications, etc.
  api.route('/partners', partnersRoutes);
  api.route('/pods', podsRoutes);
  api.route('/invites', invitesRoutes);
  api.route('/pods', chatRoutes); // /pods/:id/chat
  api.route('/pods', notesRoutes); // /pods/:id/notes
  api.route('/pods', podHealthRoutes); // /pods/:id/health
  api.route('/pods', telegramPodLinkRoutes); // /pods/:id/telegram/link/start
  api.route('/', calendarRoutes); // mounts /me/availability, /me/calendars
  api.route('/', telegramLinkRoutes); // /me/telegram/link/start, /me/telegram/disconnect
  api.route('/schedule', scheduleRoutes);
  // AI / LLM-powered routes (Phase 8). All authenticated; degrade gracefully
  // when ANTHROPIC_API_KEY is unset.
  api.route('/', aiPartnerRoutes); // /partners/:id/preferences/natural[/confirm]
  api.route('/schedule', aiScheduleRoutes); // /schedule/explain, /schedule/reshuffle/natural
  api.route('/', featuresRoutes); // /me/features
  app.route('/api', api);

  if (!config.anthropic.enabled) {
    logger.info('AI features disabled (no Anthropic API key)');
  }
  if (!config.telegram.enabled) {
    logger.info('Telegram disabled (no bot token)');
  }

  return app;
}
