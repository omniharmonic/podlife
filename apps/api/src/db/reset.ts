/**
 * DEV ONLY: Drop the public schema, run migrate + seed.
 * Refuses to run if NODE_ENV=production.
 */
import { config } from '../lib/config.js';
import { pool, shutdownDb } from './index.js';

async function main(): Promise<void> {
  if (config.isProduction) {
    throw new Error('Refusing to run db:reset in production');
  }
  // eslint-disable-next-line no-console
  console.log('[reset] dropping schemas public + drizzle…');
  // Drop BOTH `public` (app tables) and `drizzle` (the migrator's journal).
  // Forgetting `drizzle` makes the migrator think 0000 already ran, leaving
  // post-migrate.sql to ALTER tables that don't exist.
  await pool.unsafe(
    `DROP SCHEMA IF EXISTS public CASCADE;
     DROP SCHEMA IF EXISTS drizzle CASCADE;
     CREATE SCHEMA public;`,
  );
  await pool.unsafe(`GRANT ALL ON SCHEMA public TO podlife;`);
  // eslint-disable-next-line no-console
  console.log('[reset] running migrations…');
  // Re-import migrate flow to apply against the fresh schema.
  await import('./migrate.js');
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[reset] failed:', err);
  await shutdownDb();
  process.exitCode = 1;
});
