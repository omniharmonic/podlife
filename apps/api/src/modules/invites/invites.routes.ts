/**
 * Unified invite routes. The /preview endpoint is intentionally public —
 * the landing page must render before the user has a session, since the
 * whole point of the signup-on-accept flow is "click link → maybe sign up
 * → accept". Mount accordingly in app.ts.
 *
 * See modules/invites/invites.service.ts for the privacy invariants on what
 * the preview is allowed to expose.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createInviteSchema } from '@pod-life/shared';
import {
  acceptInvite,
  createInvite,
  getInvitePreview,
  listMyInvites,
  revokeInvite,
} from './invites.service.js';

// Public router — no auth applied. Mounted at /api/invites in app.ts BEFORE
// the authed group, so a request for /api/invites/:token/preview never sees
// requireAuth. The path is namespaced under /preview/ so it cannot collide
// with the authed `:token/accept` and `:token` (revoke) routes.
export const invitesPublicRoutes = new Hono();

invitesPublicRoutes.get('/:token/preview', async (c) => {
  const token = c.req.param('token');
  const preview = await getInvitePreview(token);
  return c.json(preview);
});

// Authed router — mounted inside the api group (requireAuth + privacyScrub).
export const invitesRoutes = new Hono();

invitesRoutes.post('/', zValidator('json', createInviteSchema), async (c) => {
  const me = c.get('person');
  const params = c.req.valid('json');
  const result = await createInvite(me.id, params);
  return c.json(result);
});

invitesRoutes.get('/', async (c) => {
  const me = c.get('person');
  const list = await listMyInvites(me.id);
  return c.json({ invites: list });
});

invitesRoutes.post('/:token/accept', async (c) => {
  const me = c.get('person');
  const token = c.req.param('token');
  const result = await acceptInvite(me.id, token);
  return c.json(result);
});

invitesRoutes.delete('/:token', async (c) => {
  const me = c.get('person');
  const token = c.req.param('token');
  await revokeInvite(me.id, token);
  return c.json({ ok: true });
});
