/**
 * Auth routes: magic-link request, verify, logout.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  requestMagicLinkSchema,
  verifyMagicLinkSchema,
} from '@pod-life/shared';
import { logout, requestMagicLink, verifyMagicLink } from './magic-link.service.ts';
import { toPersonDto } from '../persons/persons.dto.ts';

export const authRoutes = new Hono();

authRoutes.post('/magic-link', zValidator('json', requestMagicLinkSchema), async (c) => {
  const { email } = c.req.valid('json');
  const result = await requestMagicLink(email);
  // Always 200, never reveal whether the email exists. Dev fields included
  // when SMTP isn't configured to make local testing tolerable.
  return c.json(result);
});

authRoutes.post('/verify', zValidator('json', verifyMagicLinkSchema), async (c) => {
  const { email, token } = c.req.valid('json');
  const { sessionToken, person } = await verifyMagicLink(email, token);
  return c.json({ sessionToken, person: toPersonDto(person) });
});

authRoutes.post('/logout', async (c) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) await logout(token);
  return c.json({ ok: true });
});
