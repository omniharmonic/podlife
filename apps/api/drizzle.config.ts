import 'dotenv/config';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { Config } from 'drizzle-kit';

// Load monorepo .env so DATABASE_URL is available.
loadEnv({ path: resolve(__dirname, '../../.env') });

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://podlife:podlife@localhost:5433/podlife',
  },
  strict: true,
  verbose: true,
} satisfies Config;
