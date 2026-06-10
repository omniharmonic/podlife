/**
 * Vercel Cron entry points.
 *
 * These routes are invoked on a schedule by Vercel's cron runner (configured
 * in the root vercel.json). They authenticate via Bearer CRON_SECRET (set
 * automatically by Vercel) and then enqueue the actual work onto the job
 * queue, so the cron tick itself stays well under the function timeout.
 */
import { Hono } from 'hono';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { safeEqual } from '../../lib/timing.js';
import { queue } from '../../jobs/queue.js';

export const cronRoutes = new Hono();

function verifyCron(authHeader: string | null): boolean {
  // In dev, allow without secret so you can curl locally.
  if (!config.cronSecret) return !config.isProduction;
  if (!authHeader) return false;
  return safeEqual(authHeader, `Bearer ${config.cronSecret}`);
}

cronRoutes.get('/auto-lock', async (c) => {
  if (!verifyCron(c.req.header('authorization') ?? null)) {
    return c.text('Unauthorized', 401);
  }
  await queue.enqueue('auto-lock', {}, { attempts: 2 });
  logger.info('cron: auto-lock enqueued');
  return c.json({ ok: true });
});

cronRoutes.get('/weekly-cycle', async (c) => {
  if (!verifyCron(c.req.header('authorization') ?? null)) {
    return c.text('Unauthorized', 401);
  }
  // Stubbed for now — will scan pods due for a cycle and enqueue run-cycle
  // for each. Wired up alongside the cycle scheduler implementation.
  logger.info('cron: weekly-cycle tick (stub)');
  return c.json({ ok: true, dispatched: 0 });
});
