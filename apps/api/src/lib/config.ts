/**
 * Typed environment loader. Throws on invalid configuration at boot.
 * See arch § 14.2.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env from monorepo root (../../.env) and from apps/api/.env if present.
loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env'), override: false });

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Privileged connection used ONLY by migrations (CREATE EXTENSION, CREATE
  // ROLE, FORCE RLS, etc.). The runtime DATABASE_URL should be a non-superuser
  // role so RLS applies; this admin URL is the owner/superuser. Falls back to
  // DATABASE_URL when unset (fine for single-role local setups).
  DATABASE_ADMIN_URL: z.string().optional().default(''),
  // REDIS_URL is required only when no Upstash Redis is configured.
  // The cross-field check happens after parse — see below.
  REDIS_URL: z.string().optional().default(''),
  ENCRYPTION_KEY: z
    .string()
    .regex(HEX_64, 'ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32'),
  APP_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),

  PORT: z.coerce.number().int().positive().default(3000),

  // Optimizer
  OPTIMIZER_URL: z.string().url().default('http://localhost:8000'),

  // Optional — features degrade gracefully
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('hello@podlife.local'),
  RESEND_API_KEY: z.string().optional().default(''),

  // Upstash + QStash (serverless deployments). Leave blank for self-hosted.
  // The Vercel Upstash marketplace integration provisions vars with `KV_`
  // prefix by default (KV_REST_API_URL / KV_REST_API_TOKEN); we accept those
  // as aliases for the canonical UPSTASH_REDIS_REST_* names.
  UPSTASH_REDIS_REST_URL: z.string().optional().default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(''),
  KV_REST_API_URL: z.string().optional().default(''),
  KV_REST_API_TOKEN: z.string().optional().default(''),
  QSTASH_TOKEN: z.string().optional().default(''),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional().default(''),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional().default(''),

  // Vercel Cron shared secret. Required when deploying to Vercel.
  CRON_SECRET: z.string().optional().default(''),

  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),

  MS_CLIENT_ID: z.string().optional().default(''),
  MS_CLIENT_SECRET: z.string().optional().default(''),
  MS_TENANT_ID: z.string().optional().default('common'),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_URL: z.string().optional().default(''),

  ANTHROPIC_API_KEY: z.string().optional().default(''),

  WORKER: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  throw new Error('Invalid environment configuration');
}

// Cross-field check: at least one Redis transport must be configured.
const hasIORedis = !!parsed.data.REDIS_URL;
const hasUpstash =
  !!(parsed.data.UPSTASH_REDIS_REST_URL || parsed.data.KV_REST_API_URL) &&
  !!(parsed.data.UPSTASH_REDIS_REST_TOKEN || parsed.data.KV_REST_API_TOKEN);
if (!hasIORedis && !hasUpstash) {
  throw new Error(
    'No Redis transport configured. Set REDIS_URL (self-hosted) or both ' +
      'UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN (or the Vercel marketplace ' +
      'aliases KV_REST_API_URL+KV_REST_API_TOKEN).',
  );
}

export const config = Object.freeze({
  env: parsed.data.NODE_ENV,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  port: parsed.data.PORT,
  appUrl: parsed.data.APP_URL,
  frontendUrl: parsed.data.FRONTEND_URL,
  databaseUrl: parsed.data.DATABASE_URL,
  databaseAdminUrl: parsed.data.DATABASE_ADMIN_URL || parsed.data.DATABASE_URL,
  redisUrl: parsed.data.REDIS_URL,
  encryptionKey: parsed.data.ENCRYPTION_KEY,
  optimizerUrl: parsed.data.OPTIMIZER_URL,
  smtp: {
    host: parsed.data.SMTP_HOST,
    port: parsed.data.SMTP_PORT,
    user: parsed.data.SMTP_USER,
    pass: parsed.data.SMTP_PASS,
    from: parsed.data.EMAIL_FROM,
    enabled: !!parsed.data.SMTP_HOST,
  },
  resend: {
    apiKey: parsed.data.RESEND_API_KEY,
    from: parsed.data.EMAIL_FROM,
    enabled: !!parsed.data.RESEND_API_KEY,
  },
  upstash: {
    // Prefer canonical UPSTASH_REDIS_* names; fall back to KV_REST_API_* aliases
    // emitted by the Vercel Upstash marketplace integration.
    redisUrl: parsed.data.UPSTASH_REDIS_REST_URL || parsed.data.KV_REST_API_URL,
    redisToken: parsed.data.UPSTASH_REDIS_REST_TOKEN || parsed.data.KV_REST_API_TOKEN,
    qstashToken: parsed.data.QSTASH_TOKEN,
    qstashCurrentSigningKey: parsed.data.QSTASH_CURRENT_SIGNING_KEY,
    qstashNextSigningKey: parsed.data.QSTASH_NEXT_SIGNING_KEY,
    redisEnabled: !!(parsed.data.UPSTASH_REDIS_REST_URL || parsed.data.KV_REST_API_URL),
    qstashEnabled: !!parsed.data.QSTASH_TOKEN,
  },
  cronSecret: parsed.data.CRON_SECRET,
  google: {
    clientId: parsed.data.GOOGLE_CLIENT_ID,
    clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
    enabled: !!(parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET),
  },
  microsoft: {
    clientId: parsed.data.MS_CLIENT_ID,
    clientSecret: parsed.data.MS_CLIENT_SECRET,
    tenantId: parsed.data.MS_TENANT_ID,
    enabled: !!(parsed.data.MS_CLIENT_ID && parsed.data.MS_CLIENT_SECRET),
  },
  telegram: {
    botToken: parsed.data.TELEGRAM_BOT_TOKEN,
    webhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET,
    botUsername: parsed.data.TELEGRAM_BOT_USERNAME,
    webhookUrl: parsed.data.TELEGRAM_WEBHOOK_URL,
    enabled: !!parsed.data.TELEGRAM_BOT_TOKEN,
  },
  anthropic: {
    apiKey: parsed.data.ANTHROPIC_API_KEY,
    enabled: !!parsed.data.ANTHROPIC_API_KEY,
  },
  worker: parsed.data.WORKER === '1',
});

export type AppConfig = typeof config;
