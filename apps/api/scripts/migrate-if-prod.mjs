#!/usr/bin/env node
/**
 * Run drizzle migrations only on Vercel production builds. No-op on
 * preview/development so contributors don't accidentally point migrations
 * at the wrong DB while iterating.
 *
 * Wired into vercel.json's buildCommand so the schema and the deployed
 * code always advance together.
 */
import { execSync } from 'node:child_process';

const env = process.env.VERCEL_ENV ?? '';
if (env !== 'production') {
  console.log(`[migrate] skipped — VERCEL_ENV='${env || 'unset'}'`);
  process.exit(0);
}

console.log('[migrate] VERCEL_ENV=production — applying migrations');
execSync('pnpm db:migrate', { stdio: 'inherit' });
