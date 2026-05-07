/**
 * Vercel Functions entry point.
 *
 * One function handles every API request. The Hono app is built once at
 * cold-start and reused via Fluid Compute warm-instance reuse, so request
 * latency is bounded by the slowest middleware/handler — not Hono setup.
 *
 * Self-hosted deploys use src/index.ts (long-running Node server) instead.
 */
import { handle } from 'hono/vercel';
import { buildApp } from '../src/app.js';

const app = buildApp();

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);

// Vercel runtime config — Node.js, ample timeout for cycle orchestration.
// Per-function overrides live in apps/api/vercel.json (functions block).
export const config = {
  runtime: 'nodejs',
  // Fluid Compute is on by default. Default 300s timeout is plenty.
  maxDuration: 60,
};
