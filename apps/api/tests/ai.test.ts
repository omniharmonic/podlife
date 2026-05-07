/**
 * AI / LLM route tests (Phase 8).
 *
 * Strategy
 * ────────
 *  1. Unit-shaped tests use a mocked LlmService injected via setLlmServiceForTests
 *     so we never call the real API.
 *  2. The /me/features endpoint reflects env vars and never calls the LLM.
 *  3. With no key set, AI routes return 503 LLM_UNAVAILABLE.
 *  4. An optional "smoke" test runs against the real Anthropic API only when
 *     ANTHROPIC_API_KEY is set in the environment — otherwise it's skipped.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';
import {
  LlmService,
  setLlmServiceForTests,
} from '../src/services/llm/llm.service.ts';

const realKey = process.env.ANTHROPIC_API_KEY;

describe('ai / features', () => {
  it('reports ai/telegram flags based on env', async () => {
    const app = newApp();
    const email = uniqueEmail('ai-feat');
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const tok = v.body.sessionToken;

    const f = await call(app, '/api/me/features', { token: tok });
    expect(f.status).toBe(200);
    expect(typeof f.body.ai).toBe('boolean');
    expect(typeof f.body.telegram).toBe('boolean');

    await deletePerson(email);
  });
});

describe('ai / parsePreferences route (mocked LLM)', () => {
  const created: string[] = [];

  beforeEach(() => {
    // Inject a mock service that bypasses the API key requirement.
    const mock = new LlmService({ apiKey: 'sk-test-mock' });
    // Override methods directly.
    mock.parsePreferences = async ({ partnerName, naturalLanguageInput }) => {
      const wantsOvernight = /overnight|saturday/i.test(naturalLanguageInput);
      const twiceAWeek = /twice a week|2x|two times/i.test(naturalLanguageInput);
      return {
        result: {
          proposed: {
            cadence: 'weekly',
            prefDateNights: twiceAWeek ? 2 : undefined,
            prefOvernights: wantsOvernight ? 1 : undefined,
          } as never,
          rationale: `Parsed something for ${partnerName}.`,
          ambiguous: false,
        },
        meta: {
          feature: 'parsePreferences',
          model: 'mock',
          inputTokens: 10,
          outputTokens: 10,
          latencyMs: 5,
        },
      };
    };
    setLlmServiceForTests(mock);
  });

  afterEach(async () => {
    setLlmServiceForTests(null);
    for (const e of created.splice(0)) await deletePerson(e);
  });

  it('returns parsed proposal for valid partnership', async () => {
    const app = newApp();
    const aEmail = uniqueEmail('ai-a');
    const bEmail = uniqueEmail('ai-b');
    created.push(aEmail, bEmail);

    const aReq = await call(app, '/auth/magic-link', { method: 'POST', json: { email: aEmail } });
    const aVer = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email: aEmail, token: aReq.body.devToken },
    });
    const aTok = aVer.body.sessionToken;

    const bReq = await call(app, '/auth/magic-link', { method: 'POST', json: { email: bEmail } });
    const bVer = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email: bEmail, token: bReq.body.devToken },
    });
    const bTok = bVer.body.sessionToken;

    const inv = await call(app, '/api/partners/invite', {
      method: 'POST',
      token: aTok,
      json: {},
    });
    const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: bTok,
    });
    const partnershipId = acc.body.partnershipId;

    const res = await call(app, `/api/partners/${partnershipId}/preferences/natural`, {
      method: 'POST',
      token: aTok,
      json: { input: 'I want to see them about twice a week, plus a Saturday overnight' },
    });

    expect(res.status).toBe(200);
    expect(res.body.proposed.cadence).toBe('weekly');
    expect(res.body.proposed.prefDateNights).toBe(2);
    expect(res.body.proposed.prefOvernights).toBe(1);
    expect(res.body.ambiguous).toBe(false);
    expect(typeof res.body.rationale).toBe('string');
  });

  it('rejects non-member of partnership with 403', async () => {
    const app = newApp();
    const aEmail = uniqueEmail('ai-a');
    const bEmail = uniqueEmail('ai-b');
    const cEmail = uniqueEmail('ai-c');
    created.push(aEmail, bEmail, cEmail);

    async function authedSession(email: string): Promise<string> {
      const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
      const v = await call(app, '/auth/verify', {
        method: 'POST',
        json: { email, token: r.body.devToken },
      });
      return v.body.sessionToken;
    }
    const aTok = await authedSession(aEmail);
    const bTok = await authedSession(bEmail);
    const cTok = await authedSession(cEmail);

    const inv = await call(app, '/api/partners/invite', {
      method: 'POST',
      token: aTok,
      json: {},
    });
    const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: bTok,
    });
    const partnershipId = acc.body.partnershipId;

    // C is not a member of A↔B.
    const res = await call(app, `/api/partners/${partnershipId}/preferences/natural`, {
      method: 'POST',
      token: cTok,
      json: { input: 'whatever' },
    });
    expect([403, 404]).toContain(res.status);
  });
});

describe('ai / no API key configured', () => {
  beforeEach(() => {
    // No mock injected → real singleton path → no API key → LlmUnavailableError.
    setLlmServiceForTests(new LlmService({ apiKey: '' }));
  });
  afterEach(() => {
    setLlmServiceForTests(null);
  });

  it('returns 503 when key is missing', async () => {
    const app = newApp();
    const email = uniqueEmail('ai-no');
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    const tok = v.body.sessionToken;

    // We need a real partnership to reach the LLM call. Create one.
    const bEmail = uniqueEmail('ai-no-b');
    const r2 = await call(app, '/auth/magic-link', { method: 'POST', json: { email: bEmail } });
    const v2 = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email: bEmail, token: r2.body.devToken },
    });
    const bTok = v2.body.sessionToken;

    const inv = await call(app, '/api/partners/invite', {
      method: 'POST',
      token: tok,
      json: {},
    });
    const acc = await call(app, `/api/partners/accept/${inv.body.token}`, {
      method: 'POST',
      token: bTok,
    });

    const res = await call(app, `/api/partners/${acc.body.partnershipId}/preferences/natural`, {
      method: 'POST',
      token: tok,
      json: { input: 'twice a week please' },
    });
    expect(res.status).toBe(503);
    expect(res.body?.error?.code).toBe('LLM_UNAVAILABLE');

    await deletePerson(email);
    await deletePerson(bEmail);
  });
});

describe.skipIf(!realKey)('ai / parsePreferences integration (real Anthropic API)', () => {
  it('returns sensible structured output for a clear input', async () => {
    const svc = new LlmService(); // uses real key from env
    const out = await svc.parsePreferences({
      partnerName: 'Alex',
      currentPrefs: { cadence: 'weekly' },
      naturalLanguageInput:
        'I want to see Alex about twice a week, mostly evenings, plus an overnight on Saturdays.',
    });
    expect(out.result).toBeDefined();
    expect(typeof out.result.rationale).toBe('string');
    // Should have extracted at least one numeric preference.
    const proposed = out.result.proposed;
    const hasSomething =
      proposed.prefDateNights !== undefined ||
      proposed.prefOvernights !== undefined ||
      proposed.prefIdealHours !== undefined ||
      proposed.cadence !== undefined;
    expect(hasSomething).toBe(true);
  }, 30_000);
});
