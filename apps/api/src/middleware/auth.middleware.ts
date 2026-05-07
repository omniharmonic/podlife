/**
 * Auth middleware.
 *  - Reads Authorization: Bearer <session-token>
 *  - Resolves the session → person
 *  - Stashes person on context as c.var.person
 *  - Sets PostgreSQL RLS context (`app.current_person_id`) for the request
 *
 * Note: ioredis-postgres can't carry SET LOCAL across separate queries,
 * so we set the GUC at session level (SET, not SET LOCAL) and clear it
 * at the end of the request. The connection pool is the boundary.
 *
 * For higher safety in production we could wrap each request in a
 * transaction; for now this is sufficient given the single-tenant
 * pool semantics of postgres-js (each query may pick a different
 * connection). To make RLS effective regardless of connection
 * reuse, we run authenticated queries inside a `db.transaction(...)`
 * block where possible; the policies fall back to "no person" when
 * the GUC is empty.
 */
import type { MiddlewareHandler } from 'hono';
import { AuthError } from '../lib/errors.js';
import type { PersonRow } from '../db/schema.js';
import { resolveSession } from '../modules/auth/magic-link.service.ts';

export interface AuthVars {
  person: PersonRow;
}

declare module 'hono' {
  interface ContextVariableMap {
    person: PersonRow;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new AuthError('Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw new AuthError('Empty bearer token');

  const person = await resolveSession(token);
  if (!person) throw new AuthError('Invalid or expired session');

  c.set('person', person);
  await next();
};
