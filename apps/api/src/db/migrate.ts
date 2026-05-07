/**
 * Apply Drizzle migrations + post-migrate SQL (RLS, triggers) + seed.
 * Run with: pnpm db:migrate
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, pool, shutdownDb } from './index.js';
import { runSeed } from './seed.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  // 1. Pre-migrate: ensure required extensions exist.
  await pool.unsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.unsafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // 2. Drizzle migrations.
  await migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });

  // 3. Post-migrate: triggers + RLS.
  const postSql = readFileSync(resolve(__dirname, 'post-migrate.sql'), 'utf8');
  await pool.unsafe(postSql);

  // 4. Seed default event types.
  await runSeed();

  // eslint-disable-next-line no-console
  console.log('[migrate] complete');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownDb();
  });
