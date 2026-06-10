/**
 * Drizzle DB instance — dual-driver adapter.
 *
 * Selects between two drivers based on DATABASE_URL:
 *   - Neon hostnames (*.neon.tech)  → @neondatabase/serverless Pool
 *                                     (WebSocket; supports transactions; ideal
 *                                      for Vercel Functions / serverless).
 *   - Anything else                 → postgres-js
 *                                     (TCP; ideal for self-hosted Postgres
 *                                      and local Docker dev).
 *
 * Both backends expose the same Drizzle surface, so application code
 * does not change. The RLS pattern in db/rls.ts (SET LOCAL inside a
 * transaction) requires session-state, so the HTTP-only neon() driver
 * is intentionally NOT used here — Neon Pool over WebSocket is.
 *
 * See arch § 4.x.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { drizzle as drizzlePostgresJs } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { config } from '../lib/config.js';
import * as schema from './schema.js';

const isNeon = /\.neon\.tech\b/i.test(config.databaseUrl);

type DrizzlePgJs = ReturnType<typeof drizzlePostgresJs<typeof schema>>;

// ─── Request-scoped DB context (RLS) ────────────────────────────────────────
// The `db` export below is a proxy that resolves to one of three handles per
// the current async context:
//   1. A person-scoped transaction (ctx.tx) — set by runWithPersonContext for
//      authenticated requests. RLS sees `app.current_person_id` and the user
//      can only read their own rows.
//   2. The service handle (ctx.service) — set by runWithServiceContext for
//      trusted server code (jobs, webhooks, cross-person aggregations). Every
//      serviceDb connection carries `app.bypass_rls=on`, so RLS is bypassed by
//      design. This GUC is NEVER derived from request input.
//   3. The base handle (no context) — RLS is deny-by-default, so reads of
//      protected tables return nothing. This is the safe fallback.
interface DbContext {
  tx?: unknown;
  service?: boolean;
}
export const dbContext = new AsyncLocalStorage<DbContext>();

// libpq startup option that sets the bypass GUC on every service connection.
const BYPASS_OPTION = '-c app.bypass_rls=on';

let dbInstance: DrizzlePgJs;
let serviceInstance: DrizzlePgJs;
let postgresClient: ReturnType<typeof postgres> | null = null;
let serviceClient: ReturnType<typeof postgres> | null = null;
let shutdownFn: () => Promise<void>;
let driverName: 'neon-serverless' | 'postgres-js';

if (isNeon) {
  // In Node.js (non-edge) runtimes the package needs a WebSocket constructor.
  // Vercel Node functions don't expose `globalThis.WebSocket`, so wire one in
  // via the optional `ws` peer dep. Skipped if `ws` isn't installed.
  if (typeof globalThis.WebSocket === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const ws = require('ws') as { WebSocket: any };
      neonConfig.webSocketConstructor = ws.WebSocket;
    } catch {
      // `ws` not installed — fine on edge runtimes that have global WebSocket.
    }
  }
  const pool = new NeonPool({ connectionString: config.databaseUrl });
  // Drizzle's neon-serverless and postgres-js drivers expose the same query
  // and transaction API used in this codebase. We surface the postgres-js
  // typing for ergonomics; the runtime is interchangeable.
  dbInstance = drizzleNeon(pool, { schema }) as unknown as DrizzlePgJs;
  // Service pool: append the bypass GUC via the libpq `options` startup param.
  const sep = config.databaseUrl.includes('?') ? '&' : '?';
  const serviceUrl = `${config.databaseUrl}${sep}options=${encodeURIComponent(BYPASS_OPTION)}`;
  const servicePool = new NeonPool({ connectionString: serviceUrl });
  serviceInstance = drizzleNeon(servicePool, { schema }) as unknown as DrizzlePgJs;
  driverName = 'neon-serverless';
  shutdownFn = async () => {
    await pool.end();
    await servicePool.end();
  };
} else {
  postgresClient = postgres(config.databaseUrl, {
    max: 20,
    idle_timeout: 20,
    prepare: false, // helps with BEGIN/SET LOCAL flow used for RLS
  });
  dbInstance = drizzlePostgresJs(postgresClient, { schema });
  // Service pool: every connection sets `app.bypass_rls=on` at startup.
  serviceClient = postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
    connection: { options: BYPASS_OPTION },
  });
  serviceInstance = drizzlePostgresJs(serviceClient, { schema });
  driverName = 'postgres-js';
  shutdownFn = async () => {
    if (postgresClient) await postgresClient.end({ timeout: 5 });
    if (serviceClient) await serviceClient.end({ timeout: 5 });
  };
}

/** Base handle — no RLS context. Used to open person-scoped transactions. */
export const baseDb = dbInstance;
/** Service handle — every connection bypasses RLS. Trusted server code only. */
export const serviceDb = serviceInstance;

/**
 * Context-aware DB handle. Resolves per async context (see DbContext above).
 * Application code imports this and never needs to know which handle it is.
 */
export const db = new Proxy(dbInstance, {
  get(target, prop, receiver) {
    const ctx = dbContext.getStore();
    let real: unknown = target;
    if (ctx?.tx) real = ctx.tx;
    else if (ctx?.service) real = serviceInstance;
    else if (config.isTest) {
      // In tests, bare `db` calls outside any request (seeding, assertions)
      // run with RLS bypassed so fixtures can read/write across persons. Code
      // under test still goes through routes, which install person context via
      // runWithPersonContext — so RLS enforcement is exercised for real there.
      // In production a no-context query stays deny-by-default.
      real = serviceInstance;
    }
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(real)
      : value;
  },
}) as DrizzlePgJs;

export type DB = typeof db;
export { schema };

/**
 * Raw postgres-js handle for migrations and admin scripts (uses .unsafe()).
 * Only available when the postgres-js driver is selected. Throws on access
 * in Neon mode — run migrations with the unpooled connection string and
 * a standard pg client there.
 */
export function getRawPostgresClient(): ReturnType<typeof postgres> {
  if (!postgresClient) {
    throw new Error(
      'getRawPostgresClient() is unavailable on the Neon driver. ' +
        'Run migrations against the unpooled DATABASE_URL with a standard pg client.',
    );
  }
  return postgresClient;
}

/** @deprecated Use getRawPostgresClient() instead. */
export const pool = new Proxy({} as ReturnType<typeof postgres>, {
  get(_t, prop) {
    return Reflect.get(getRawPostgresClient(), prop);
  },
  apply(_t, _this, args: unknown[]) {
    // postgres-js client is callable as a tagged template — forward.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-spread
    return (getRawPostgresClient() as any)(...args);
  },
});

export const dbDriver = driverName;

export async function shutdownDb(): Promise<void> {
  await shutdownFn();
}
