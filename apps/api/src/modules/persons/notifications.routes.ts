/**
 * Notifications hub: list / mark-read / mark-all-read for /api/me/notifications.
 *
 * Privacy: every query is scoped to the authenticated person (`me.id`).
 * The privacy-scrub middleware additionally strips any unexpected fields.
 */
import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { notifications } from '../../db/schema.ts';
import { NotFoundError } from '../../lib/errors.ts';

export const notificationsRoutes = new Hono();

notificationsRoutes.get('/me/notifications', async (c) => {
  const me = c.get('person');
  const limitParam = c.req.query('limit');
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const limit = Math.min(Math.max(limitParam ? Number(limitParam) : 20, 1), 200);

  const where = unreadOnly
    ? and(eq(notifications.personId, me.id), isNull(notifications.readAt))
    : eq(notifications.personId, me.id);

  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return c.json({
    notifications: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      title: r.title,
      body: r.body,
      actionUrl: r.actionUrl,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
    })),
  });
});

notificationsRoutes.post('/me/notifications/:id/read', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.personId, me.id),
        isNull(notifications.readAt),
      ),
    )
    .returning();
  if (!updated) {
    // Either not found, not owned by me, or already read. We treat
    // "already read" as a no-op success (idempotent), but reject when the
    // notification doesn't exist for this person.
    const exists = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.personId, me.id)))
      .limit(1);
    if (!exists[0]) throw new NotFoundError('Notification not found');
  }
  return c.json({ ok: true });
});

notificationsRoutes.post('/me/notifications/read-all', async (c) => {
  const me = c.get('person');
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.personId, me.id), isNull(notifications.readAt)));
  return c.json({ ok: true });
});
