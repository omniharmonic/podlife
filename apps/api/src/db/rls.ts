/**
 * Helpers for running queries within a person's RLS context.
 *
 * Because postgres-js can hand any connection to any query, RLS state set
 * via plain `SET` would leak between requests. We therefore use a
 * transaction and `SET LOCAL`, which is scoped to that transaction.
 */
import { sql } from 'drizzle-orm';
import { db } from './index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withPersonContext<T>(
  personId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // SET LOCAL scopes the GUC to this transaction.
    await tx.execute(sql`SELECT set_config('app.current_person_id', ${personId}, true)`);
    return fn(tx);
  });
}
