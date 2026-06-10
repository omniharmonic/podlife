/**
 * Helpers for running queries within a Row-Level-Security context.
 *
 * Two contexts exist:
 *
 *  - Person context: an authenticated request runs inside a transaction with
 *    `app.current_person_id` set LOCAL. Postgres RLS policies then restrict
 *    reads of protected tables (partnerships, partnership_preferences,
 *    pod_members, time_blocks) to rows the person is entitled to see. The
 *    transaction also pins one connection so the GUC can't leak between
 *    requests on a shared pool.
 *
 *  - Service context: trusted server code (background jobs, webhook handlers,
 *    cross-person aggregations) routes `db` to a dedicated pool whose
 *    connections carry `app.bypass_rls=on`. RLS is bypassed by design. The
 *    bypass GUC is set only via that pool's connection options — never from
 *    user-controlled input.
 *
 * Both helpers install their context into AsyncLocalStorage so the `db` proxy
 * (see db/index.ts) routes every query made within `fn` to the right handle.
 */
import { sql } from 'drizzle-orm';
import { baseDb, dbContext } from './index.js';

/**
 * Run `fn` with the given person as the RLS subject. Opens a transaction,
 * sets `app.current_person_id` LOCAL, and routes all `db` queries through it.
 */
export async function runWithPersonContext<T>(
  personId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return baseDb.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_person_id', ${personId}, true)`,
    );
    return dbContext.run({ tx }, fn);
  });
}

/**
 * Run `fn` with RLS bypassed (trusted server code only). Routes all `db`
 * queries to the service pool. Does NOT open a transaction, so long-running
 * jobs that make external calls don't hold a connection open the whole time.
 */
export async function runWithServiceContext<T>(fn: () => Promise<T>): Promise<T> {
  return dbContext.run({ service: true }, fn);
}
