import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  proposePartnershipCadenceSchema,
  updatePartnershipPreferencesSchema,
  updatePartnershipStatusSchema,
  updatePartnershipTypeSchema,
} from '@pod-life/shared';
import {
  acceptCadenceProposal,
  declineCadenceProposal,
  getMyPreferences,
  listPartners,
  proposeCadence,
  updateMyPreferences,
  updatePartnershipStatus,
  updateRelationshipType,
} from './partners.service.js';

export const partnersRoutes = new Hono();

// Invite mint/accept lives on the unified /api/invites module — partner
// invites and pod invites share preview, accept, and revoke surfaces so the
// frontend can use a single landing page (/join/:token).

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

// Cadence: three discrete verbs (propose / accept / decline) instead of a
// single PATCH so the UI can wire each action to its own button with clear
// semantics. See partners.service.ts for the state-machine rules.
partnersRoutes.post(
  '/:id/cadence/propose',
  zValidator('json', proposePartnershipCadenceSchema),
  async (c) => {
    const me = c.get('person');
    const id = c.req.param('id');
    const { cadence } = c.req.valid('json');
    const result = await proposeCadence(me.id, id, cadence);
    return c.json(result);
  },
);

partnersRoutes.post('/:id/cadence/accept', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const result = await acceptCadenceProposal(me.id, id);
  return c.json(result);
});

partnersRoutes.post('/:id/cadence/decline', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const result = await declineCadenceProposal(me.id, id);
  return c.json(result);
});
