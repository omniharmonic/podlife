/**
 * Internal job webhook routes.
 *
 * QStash POSTs to these endpoints to invoke job handlers. They are the
 * serverless equivalent of a BullMQ worker process.
 *
 * Security: every request must carry a valid QStash signature. The
 * Receiver verifies the body against QSTASH_CURRENT_SIGNING_KEY (and
 * QSTASH_NEXT_SIGNING_KEY during key rotation). Without a valid sig we
 * reject with 401.
 *
 * Vercel Cron also POSTs here (via /api/cron/* trampolines). Cron
 * requests carry a Bearer CRON_SECRET in the Authorization header.
 */
import { Hono } from 'hono';
import { Receiver } from '@upstash/qstash';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { JOB_HANDLERS, type JobName } from '../../jobs/queue.js';

let receiver: Receiver | null = null;
function getReceiver(): Receiver | null {
  if (!config.upstash.qstashEnabled) return null;
  if (!receiver) {
    receiver = new Receiver({
      currentSigningKey: config.upstash.qstashCurrentSigningKey,
      nextSigningKey: config.upstash.qstashNextSigningKey,
    });
  }
  return receiver;
}

async function verifyQStash(c: { req: { raw: Request } }): Promise<{
  ok: boolean;
  body: string;
}> {
  const r = getReceiver();
  const signature = c.req.raw.headers.get('upstash-signature');
  const body = await c.req.raw.text();
  if (!r) {
    // No QStash configured. In production this means someone hit /internal/*
    // without the queue subsystem being set up — refuse, since BullMQ workers
    // call handlers in-process and never POST here. In dev/test allow it
    // through so contributors can probe these routes manually.
    return { ok: !config.isProduction, body };
  }
  if (!signature) return { ok: false, body };
  try {
    const ok = await r.verify({ signature, body });
    return { ok, body };
  } catch (err) {
    logger.warn('qstash signature verify failed', { err: (err as Error).message });
    return { ok: false, body };
  }
}

export const internalRoutes = new Hono();

// Helper to register one webhook route per job name.
function registerJob(name: JobName) {
  internalRoutes.post(`/${name}`, async (c) => {
    const { ok, body } = await verifyQStash(c);
    if (!ok) {
      return c.text('Unauthorized', 401);
    }
    let payload: unknown = {};
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch {
        return c.text('Bad JSON', 400);
      }
    }
    const handler = JOB_HANDLERS[name];
    try {
      const result = await handler(payload);
      logger.info('job handled', { name });
      return c.json({ ok: true, result });
    } catch (err) {
      logger.error('job failed', { name, err: (err as Error).message });
      // Return 500 so QStash retries per its retry policy.
      return c.json({ ok: false, err: (err as Error).message }, 500);
    }
  });
}

registerJob('run-cycle');
registerJob('auto-lock');
registerJob('weekly-sweep');
