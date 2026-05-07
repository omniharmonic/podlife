/**
 * Pod-access middleware: verifies the authenticated person is a member of the
 * pod identified by the route param `:id` (or `:podId`). Returns 403 with no
 * info leakage. Optionally requires admin role.
 *
 * Usage:
 *   podsRoutes.get('/:id', requirePodMember(), …)
 *   podsRoutes.patch('/:id', requirePodMember({ role: 'admin' }), …)
 */
import type { MiddlewareHandler } from 'hono';
import { and, eq, isNotNull } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from '../lib/errors.ts';
import { db } from '../db/index.ts';
import { podMembers } from '../db/schema.ts';

export interface PodAccessOptions {
  role?: 'admin' | 'member';
  paramName?: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    podId: string;
    podRole: 'admin' | 'member';
  }
}

export function requirePodMember(opts: PodAccessOptions = {}): MiddlewareHandler {
  const param = opts.paramName ?? 'id';
  return async (c, next) => {
    const me = c.get('person');
    const podId = c.req.param(param);
    if (!podId) throw new NotFoundError('Pod not found');

    const rows = await db
      .select()
      .from(podMembers)
      .where(
        and(
          eq(podMembers.podId, podId),
          eq(podMembers.personId, me.id),
          isNotNull(podMembers.joinedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new ForbiddenError('Not a member of this pod');
    if (opts.role === 'admin' && row.role !== 'admin') {
      throw new ForbiddenError('Admin access required');
    }
    c.set('podId', podId);
    c.set('podRole', row.role as 'admin' | 'member');
    await next();
  };
}
