/**
 * Pod health routes: GET /api/pods/:id/health.
 */
import { Hono } from 'hono';
import { requirePodMember } from '../../middleware/pod-access.middleware.ts';
import { getPodHealth } from './health.service.ts';

export const healthRoutes = new Hono();

healthRoutes.get('/:id/health', requirePodMember(), async (c) => {
  const podId = c.req.param('id');
  const data = await getPodHealth(podId);
  return c.json(data);
});
