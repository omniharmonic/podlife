import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createPodSchema,
  invitePodMemberSchema,
  updatePodPreferencesSchema,
  updatePodSchema,
} from '@pod-life/shared';
import {
  createPod,
  createPodInvite,
  getPodPrefs,
  getPodWithMembers,
  joinPodWithToken,
  listPodsForPerson,
  updatePod,
  updatePodPrefs,
} from './pods.service.js';
import { requirePodMember } from '../../middleware/pod-access.middleware.js';

export const podsRoutes = new Hono();

podsRoutes.get('/', async (c) => {
  const me = c.get('person');
  const pods = await listPodsForPerson(me.id);
  return c.json({ pods });
});

podsRoutes.post('/', zValidator('json', createPodSchema), async (c) => {
  const me = c.get('person');
  const data = c.req.valid('json');
  const pod = await createPod(me.id, data);
  return c.json({ pod });
});

podsRoutes.post('/join/:token', async (c) => {
  const me = c.get('person');
  const token = c.req.param('token');
  const result = await joinPodWithToken(me.id, token);
  return c.json(result);
});

podsRoutes.get('/:id', requirePodMember(), async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const data = await getPodWithMembers(me.id, id);
  return c.json(data);
});

podsRoutes.patch(
  '/:id',
  requirePodMember({ role: 'admin' }),
  zValidator('json', updatePodSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const pod = await updatePod(id, data);
    return c.json({ pod });
  },
);

podsRoutes.post(
  '/:id/invite',
  requirePodMember({ role: 'admin' }),
  zValidator('json', invitePodMemberSchema),
  async (c) => {
    const me = c.get('person');
    const id = c.req.param('id');
    const { role } = c.req.valid('json');
    const result = await createPodInvite(id, me.id, role);
    return c.json(result);
  },
);

podsRoutes.get('/:id/preferences', requirePodMember(), async (c) => {
  const id = c.req.param('id');
  const prefs = await getPodPrefs(id);
  return c.json({ preferences: prefs });
});

podsRoutes.patch(
  '/:id/preferences',
  requirePodMember({ role: 'admin' }),
  zValidator('json', updatePodPreferencesSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const prefs = await updatePodPrefs(id, data);
    return c.json({ preferences: prefs });
  },
);
