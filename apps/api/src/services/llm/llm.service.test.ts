/**
 * Unit tests for the LlmService — focuses on parsing/clamping logic that
 * doesn't require an LLM call. Tests for the route layer live in
 * tests/ai.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { LlmService } from './llm.service.ts';
import { LlmUnavailableError } from './llm.errors.ts';

describe('LlmService', () => {
  it('reports enabled=false when no API key', () => {
    const svc = new LlmService({ apiKey: '' });
    expect(svc.enabled).toBe(false);
  });

  it('reports enabled=true when API key provided', () => {
    const svc = new LlmService({ apiKey: 'sk-test' });
    expect(svc.enabled).toBe(true);
  });

  it('throws LlmUnavailableError when calling parsePreferences with no key', async () => {
    const svc = new LlmService({ apiKey: '' });
    await expect(
      svc.parsePreferences({
        partnerName: 'Alex',
        currentPrefs: {},
        naturalLanguageInput: 'twice a week',
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('throws LlmUnavailableError when calling explainSchedule with no key', async () => {
    const svc = new LlmService({ apiKey: '' });
    await expect(
      svc.explainSchedule({
        personName: 'Sam',
        satisfaction: [],
        overallPct: 0.8,
        proposedBlocks: [],
        infeasibilityNotes: [],
        question: 'why?',
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('throws LlmUnavailableError when calling parseReshuffleRequest with no key', async () => {
    const svc = new LlmService({ apiKey: '' });
    await expect(
      svc.parseReshuffleRequest({
        personName: 'Sam',
        scheduledBlocks: [],
        naturalLanguageInput: 'move tuesday',
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
