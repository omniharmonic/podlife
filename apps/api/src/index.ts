/**
 * API server entry point. Boots Hono via @hono/node-server, plus an
 * inline BullMQ worker in dev (single-process). In production the worker
 * can be split out by setting WORKER=1 in a separate process.
 */
import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { shutdownDb } from './db/index.js';
import { shutdownRedis } from './lib/redis.js';
import { startWorkers, stopWorkers } from './jobs/queue.js';

const app = buildApp();

const server = serve({
  fetch: app.fetch,
  port: config.port,
});

logger.info('api ready', { port: config.port, env: config.env });

// In development, start the worker in-process so `pnpm dev` is enough.
// In production, deploy a separate process with WORKER=1.
const inProcessWorker = !config.isProduction || config.worker;
if (inProcessWorker) {
  startWorkers();
  logger.info('worker started (in-process)');
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`received ${signal}, shutting down…`);
  try {
    await new Promise<void>((res) => server.close(() => res()));
    await stopWorkers();
    await shutdownRedis();
    await shutdownDb();
    process.exit(0);
  } catch (err) {
    logger.error('shutdown error', { err: (err as Error).message });
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
