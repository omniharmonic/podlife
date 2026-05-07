/**
 * Pod chat routes: GET / POST / DELETE under /api/pods/:id/chat.
 *
 * All routes require authentication (mounted under the authenticated /api
 * subapp) and pod membership (requirePodMember middleware).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requirePodMember } from '../../middleware/pod-access.middleware.js';
import { deleteMessage, listMessages, postMessage } from './chat.service.js';
import { ValidationError } from '../../lib/errors.js';

export const chatRoutes = new Hono();

const postBodySchema = z.object({
  body: z.string().min(1).max(2000),
});

chatRoutes.get('/:id/chat', requirePodMember(), async (c) => {
  const podId = c.req.param('id');
  const limitParam = c.req.query('limit');
  const beforeParam = c.req.query('before');
  const limit = limitParam ? Number(limitParam) : 50;
  if (Number.isNaN(limit)) throw new ValidationError('limit must be a number');
  const before = beforeParam ? new Date(beforeParam) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    throw new ValidationError('before must be an ISO timestamp');
  }
  const messages = await listMessages(podId, { limit, before });
  return c.json({ messages });
});

chatRoutes.post(
  '/:id/chat',
  requirePodMember(),
  zValidator('json', postBodySchema),
  async (c) => {
    const me = c.get('person');
    const podId = c.req.param('id');
    const { body } = c.req.valid('json');
    const message = await postMessage(podId, me.id, body);
    return c.json({ message });
  },
);

chatRoutes.delete('/:id/chat/:messageId', requirePodMember(), async (c) => {
  const me = c.get('person');
  const podId = c.req.param('id');
  const messageId = c.req.param('messageId');
  await deleteMessage(podId, me.id, messageId);
  return c.body(null, 204);
});
