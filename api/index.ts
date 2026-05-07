/**
 * Vercel Functions entry point — monorepo root.
 *
 * Vercel auto-discovers `<root>/api/*.ts` as serverless functions. This file
 * re-exports the Hono app handlers from apps/api/. We keep the implementation
 * in apps/api/src/app.ts so self-hosted (`pnpm --filter @pod-life/api dev`)
 * and serverless deploys share one codebase.
 */
import { handle } from 'hono/vercel';
import { buildApp } from '../apps/api/src/app.js';

const app = buildApp();

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};
