/**
 * Pod health routes: GET /api/pods/:id/health.
 */
import { Hono } from 'hono';
import { requirePodMember } from '../../middleware/pod-access.middleware.js';
import { runWithServiceContext } from '../../db/rls.js';
import { getPodHealth } from './health.service.js';

export const healthRoutes = new Hono();

healthRoutes.get('/:id/health', requirePodMember(), async (c) => {
  const podId = c.req.param('id');
  // requirePodMember has verified the caller belongs to this pod. The health
  // summary aggregates across ALL members (in-pod partnerships, preferences,
  // scheduled hours), which RLS would otherwise scope to just the caller. Run
  // it as a trusted server computation; only pod-appropriate aggregates are
  // returned to the (verified) member.
  const data = await runWithServiceContext(() => getPodHealth(podId));
  return c.json(data);
});
