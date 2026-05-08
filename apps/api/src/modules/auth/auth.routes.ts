/**
 * Auth routes: login-code request, verify, logout. The endpoint paths
 * (/magic-link, /verify) are kept for client/test compatibility — the body
 * fields are unchanged too. What's behind them is now a 6-character code,
 * not a deep-link token.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  requestLoginCodeSchema,
  verifyLoginCodeSchema,
} from '@pod-life/shared';
import { logout, requestLoginCode, verifyLoginCode } from './login-code.service.js';
import { toPersonDto } from '../persons/persons.dto.js';

export const authRoutes = new Hono();

authRoutes.post('/magic-link', zValidator('json', requestLoginCodeSchema), async (c) => {
  const { email } = c.req.valid('json');
  const result = await requestLoginCode(email);
  // Always 200, never reveal whether the email exists. Dev fields included
  // when SMTP isn't configured to make local testing tolerable.
  return c.json(result);
});

authRoutes.post('/verify', zValidator('json', verifyLoginCodeSchema), async (c) => {
  const { email, token } = c.req.valid('json');
  const { sessionToken, person } = await verifyLoginCode(email, token);
  return c.json({ sessionToken, person: toPersonDto(person) });
});

authRoutes.post('/logout', async (c) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) await logout(token);
  return c.json({ ok: true });
});
