import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  inviteParterSchema,
  updatePartnershipPreferencesSchema,
  updatePartnershipStatusSchema,
  updatePartnershipTypeSchema,
} from '@pod-life/shared';
import {
  acceptInvite,
  createInvite,
  getMyPreferences,
  listPartners,
  updateMyPreferences,
  updatePartnershipStatus,
  updateRelationshipType,
} from './partners.service.js';

export const partnersRoutes = new Hono();

partnersRoutes.post('/invite', zValidator('json', inviteParterSchema), async (c) => {
  const me = c.get('person');
  const { displayHint, relationshipType } = c.req.valid('json');
  const result = await createInvite(me.id, displayHint, relationshipType);
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

partnersRoutes.patch(
  '/:id/type',
  zValidator('json', updatePartnershipTypeSchema),
  async (c) => {
    const me = c.get('person');
    const id = c.req.param('id');
    const { relationshipType } = c.req.valid('json');
    const result = await updateRelationshipType(me.id, id, relationshipType);
    return c.json(result);
  },
);
