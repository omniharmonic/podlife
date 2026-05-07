/**
 * Apply Drizzle migrations + post-migrate SQL (RLS, triggers) + seed.
 * Run with: pnpm db:migrate
 *
 * This script always uses the postgres-js driver against the configured
 * DATABASE_URL — even when the runtime app is using the Neon serverless
 * driver. postgres-js speaks the standard PostgreSQL protocol and works
 * against any backend (local Postgres, Neon direct/unpooled, RDS, etc.).
 *
 * For Neon serverless deploys: point DATABASE_URL at the *direct*
 * (non-pooled) connection string when running migrations. The pooled
 * `-pooler` host runs in transaction mode and rejects some DDL statements.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from '../lib/config.js';
import * as schema from './schema.js';
import { runSeed } from './seed.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, {
    max: 1,
    prepare: false,
    // Some hosting (e.g. Neon) requires SSL even when not in the URL.
    ssl: config.databaseUrl.includes('sslmode=require') ? 'require' : undefined,
  });

  try {
    // 1. Pre-migrate: ensure required extensions exist.
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 2. Drizzle migrations.
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });

    // 3. Post-migrate: triggers + RLS.
    const postSql = readFileSync(resolve(__dirname, 'post-migrate.sql'), 'utf8');
    await sql.unsafe(postSql);

    // 4. Seed default event types — uses the runtime db instance, which is
    // fine because the seed only does INSERT ... ON CONFLICT DO NOTHING.
    await runSeed();

    // eslint-disable-next-line no-console
    console.log('[migrate] complete');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed:', err);
  process.exit(1);
});
