import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  inviteParterSchema,
  updatePartnershipPreferencesSchema,
  updatePartnershipStatusSchema,
} from '@pod-life/shared';
import {
  acceptInvite,
  createInvite,
  getMyPreferences,
  listPartners,
  updateMyPreferences,
  updatePartnershipStatus,
} from './partners.service.ts';

export const partnersRoutes = new Hono();

partnersRoutes.post('/invite', zValidator('json', inviteParterSchema), async (c) => {
  const me = c.get('person');
  const { displayHint } = c.req.valid('json');
  const result = await createInvite(me.id, displayHint);
  return c.json(result);
});

partnersRoutes.post('/accept/:token', async (c) => {
  const me = c.get('person');
  const token = c.req.param('token');
  const result = await acceptInvite(me.id, token);
  return c.json(result);
});

partnersRoutes.get('/', async (c) => {
  const me = c.get('person');
  const partners = await listPartners(me.id);
  return c.json({ partners });
});

partnersRoutes.get('/:id/preferences', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const prefs = await getMyPreferences(me.id, id);
  return c.json({ preferences: prefs });
});

partnersRoutes.patch(
  '/:id/preferences',
  zValidator('json', updatePartnershipPreferencesSchema),
  async (c) => {
    const me = c.get('person');
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const prefs = await updateMyPreferences(me.id, id, data);
    return c.json({ preferences: prefs });
  },
);

partnersRoutes.patch(
  '/:id/status',
  zValidator('json', updatePartnershipStatusSchema),
  async (c) => {
    const me = c.get('person');
    const id = c.req.param('id');
    const { status } = c.req.valid('json');
    const result = await updatePartnershipStatus(me.id, id, status);
    return c.json(result);
  },
);
