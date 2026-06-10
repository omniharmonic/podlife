/**
 * Job queue — dual-backend.
 *
 *   QSTASH_TOKEN set        → @upstash/qstash (HTTP push, serverless)
 *   otherwise               → BullMQ (Redis-backed pull workers, self-hosted)
 *
 * Both backends speak the same `enqueue(name, payload, opts)` API.
 *
 * Job handlers are plain async functions exported from their owning modules
 * (e.g. cycle.manager.processCycleJob, auto-lock.runAutoLock). The BullMQ
 * worker dispatches by job name; the QStash backend invokes the handler
 * via a webhook route (see modules/internal/internal.routes.ts).
 *
 * If you add a new job name, register its handler in `JOB_HANDLERS` below
 * and add a webhook route in internal.routes.ts.
 */
import { Queue, Worker, type Processor, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Client as QStashClient } from '@upstash/qstash';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

export type JobName = 'run-cycle' | 'auto-lock' | 'weekly-sweep';

export interface EnqueueOptions {
  /** Defer execution by N seconds (QStash: native delay; BullMQ: delay option). */
  delaySeconds?: number;
  /** Retry attempts on failure. Default 3. */
  attempts?: number;
}

export interface JobQueue {
  enqueue(name: JobName, payload: unknown, opts?: EnqueueOptions): Promise<void>;
  startWorkers(): void;
  stopWorkers(): Promise<void>;
  driver: 'bullmq' | 'qstash';
}

/**
 * The shared registry of job handlers. Both backends route through these.
 * Lazy imports keep startup cost minimal in environments that never run a
 * given handler.
 */
export const JOB_HANDLERS: Record<JobName, (payload: unknown) => Promise<unknown>> = {
  'run-cycle': async (payload) => {
    const [mod, { runWithServiceContext }] = await Promise.all([
      import('../modules/schedule/cycle.manager.js'),
      import('../db/rls.js'),
    ]);
    // Jobs operate across many persons; run with RLS bypassed (trusted code).
    return runWithServiceContext(() =>
      mod.processCycleJob(payload as { cycleId: string }),
    );
  },
  'auto-lock': async () => {
    const [mod, { runWithServiceContext }] = await Promise.all([
      import('./auto-lock.js'),
      import('../db/rls.js'),
    ]);
    return runWithServiceContext(() => mod.runAutoLock());
  },
  'weekly-sweep': async () => {
    const [mod, { runWithServiceContext }] = await Promise.all([
      import('../modules/schedule/weekly-sweep.js'),
      import('../db/rls.js'),
    ]);
    return runWithServiceContext(() => mod.runWeeklyCycleSweep());
  },
};

// ─── BullMQ backend ────────────────────────────────────────────────────────
function makeBullmqQueue(): JobQueue {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const optimizerQueue = new Queue('optimizer', { connection });
  const cronQueue = new Queue('cron', { connection });

  let optimizerWorker: Worker | null = null;
  let cronWorker: Worker | null = null;

  const queueFor = (name: JobName): Queue => {
    if (name === 'auto-lock') return cronQueue;
    return optimizerQueue;
  };

  return {
    driver: 'bullmq',

    async enqueue(name, payload, opts) {
      await queueFor(name).add(name, payload, {
        attempts: opts?.attempts ?? 3,
        backoff: { type: 'exponential', delay: 5_000 },
        delay: opts?.delaySeconds ? opts.delaySeconds * 1000 : undefined,
      });
    },

    startWorkers() {
      if (optimizerWorker) return;

      const dispatch: Processor = async (job: Job) => {
        const handler = JOB_HANDLERS[job.name as JobName];
        if (!handler) {
          throw new Error(`Unknown job name: ${job.name}`);
        }
        return handler(job.data);
      };

      optimizerWorker = new Worker('optimizer', dispatch, {
        connection,
        concurrency: 2,
      });
      optimizerWorker.on('failed', (job, err) => {
        logger.error('optimizer job failed', {
          id: job?.id,
          name: job?.name,
          err: err.message,
        });
      });

      cronWorker = new Worker('cron', dispatch, {
        connection,
        concurrency: 2,
      });
      cronWorker.on('failed', (job, err) => {
        logger.error('cron job failed', { id: job?.id, name: job?.name, err: err.message });
      });
    },

    async stopWorkers() {
      await Promise.allSettled([
        optimizerWorker?.close(),
        cronWorker?.close(),
        optimizerQueue.close(),
        cronQueue.close(),
      ]);
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    },
  };
}

// ─── QStash backend ────────────────────────────────────────────────────────
function makeQStashQueue(): JobQueue {
  const client = new QStashClient({ token: config.upstash.qstashToken });

  return {
    driver: 'qstash',

    async enqueue(name, payload, opts) {
      const url = `${config.appUrl}/internal/${name}`;
      await client.publishJSON({
        url,
        body: payload as Record<string, unknown>,
        retries: opts?.attempts ?? 3,
        delay: opts?.delaySeconds,
      });
      logger.info('qstash enqueued', { name, url, delay: opts?.delaySeconds });
    },

    startWorkers() {
      // No-op. QStash invokes /internal/* webhook routes which run inside the
      // normal Hono app — see modules/internal/internal.routes.ts.
    },

    async stopWorkers() {
      // No persistent worker to close.
    },
  };
}

// ─── Selection ─────────────────────────────────────────────────────────────
export const queue: JobQueue = config.upstash.qstashEnabled
  ? makeQStashQueue()
  : makeBullmqQueue();

// Re-exports for backward compatibility — callers can migrate gradually.
export const startWorkers = (): void => queue.startWorkers();
export const stopWorkers = (): Promise<void> => queue.stopWorkers();
