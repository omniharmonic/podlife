/**
 * RLS context middleware.
 *
 * Runs after requireAuth. Wraps the rest of the request pipeline in a
 * person-scoped transaction so every `db` query made by downstream handlers
 * is subject to Row-Level Security as the authenticated person. This is the
 * second of four privacy defense layers (CLAUDE.md § Privacy Model) and the
 * one that backstops application-level scope bugs at the database itself.
 *
 * Because the whole handler runs inside the transaction, a thrown error rolls
 * back any writes — a useful side effect that keeps failed mutations atomic.
 */
import type { MiddlewareHandler } from 'hono';
import { runWithPersonContext } from '../db/rls.js';

export const rlsContext: MiddlewareHandler = async (c, next) => {
  const person = c.get('person');
  // requireAuth runs first and guarantees `person`; guard defensively anyway.
  if (!person) {
    await next();
    return;
  }
  await runWithPersonContext(person.id, async () => {
    await next();
  });
};
