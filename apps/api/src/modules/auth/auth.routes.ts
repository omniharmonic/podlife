/**
 * Auth routes: login-code request/verify, passkey register/authenticate,
 * logout. The /magic-link + /verify paths kept their names for client and
 * test compatibility — the body now carries a 6-character code, not a
 * deep-link token.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  requestLoginCodeSchema,
  verifyLoginCodeSchema,
} from '@pod-life/shared';
import { logout, requestLoginCode, verifyLoginCode } from './login-code.service.js';
import {
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from './passkey.service.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
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

// ─── Passkeys ──────────────────────────────────────────────────────

// Authenticated — enrolling a new passkey.
authRoutes.post('/passkey/register/options', requireAuth, async (c) => {
  const me = c.get('person');
  const result = await startPasskeyRegistration(me);
  return c.json(result);
});

const finishRegistrationSchema = z.object({
  response: z.unknown(),
  nickname: z.string().max(80).optional(),
});

authRoutes.post(
  '/passkey/register/verify',
  requireAuth,
  zValidator('json', finishRegistrationSchema),
  async (c) => {
    const me = c.get('person');
    const { response, nickname } = c.req.valid('json');
    const result = await finishPasskeyRegistration(
      me,
      // The library's RegistrationResponseJSON has a deep shape we'd
      // duplicate by validating up-front; trust the library to reject
      // malformed payloads with a clear error.
      response as Parameters<typeof finishPasskeyRegistration>[1],
      nickname,
    );
    return c.json(result);
  },
);

// Public — starting a passkey sign-in. Email is optional (usernameless flow).
const authenticateOptionsSchema = z.object({
  email: z.string().email().toLowerCase().optional(),
});

authRoutes.post(
  '/passkey/authenticate/options',
  zValidator('json', authenticateOptionsSchema),
  async (c) => {
    const { email } = c.req.valid('json');
    const result = await startPasskeyAuthentication(email);
    return c.json(result);
  },
);

const finishAuthenticationSchema = z.object({
  response: z.unknown(),
  email: z.string().email().toLowerCase().optional(),
});

authRoutes.post(
  '/passkey/authenticate/verify',
  zValidator('json', finishAuthenticationSchema),
  async (c) => {
    const { response, email } = c.req.valid('json');
    const { sessionToken, person } = await finishPasskeyAuthentication(
      response as Parameters<typeof finishPasskeyAuthentication>[0],
      email,
    );
    return c.json({ sessionToken, person: toPersonDto(person) });
  },
);
