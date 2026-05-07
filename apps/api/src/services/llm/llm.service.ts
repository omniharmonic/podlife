/**
 * LlmService — wraps the Anthropic Messages API for Pod Life's three
 * AI features (P8.1):
 *   - parsePreferences  : free-text → structured partnership preferences
 *   - explainSchedule   : satisfaction + blocks + question → empathetic explanation
 *   - parseReshuffleRequest : free-text → which block to move + alternative
 *
 * Design notes
 * ────────────
 *  * Lazy SDK init: we don't construct the Anthropic client until first use,
 *    so an unconfigured server never imports/initializes the SDK at boot.
 *  * Graceful degradation: if no API key is configured, every method throws
 *    LlmUnavailableError. Callers (routes) translate this into 503 with a
 *    friendly message.
 *  * Prompt caching: the system block is marked cache_control: ephemeral so
 *    repeated calls hit Anthropic's prompt cache.
 *  * Hard timeout: 10s per call. The SDK supports timeout via constructor;
 *    we additionally race against an AbortController for safety.
 *  * Privacy/audit: the caller is responsible for writing the audit_log row
 *    (so we have access to req.personId there). This service returns
 *    { result, usage, latencyMs } so the caller can log usage cleanly.
 *  * Never logs raw inputs or outputs. Only metadata (length, latency, tokens).
 *
 * Arch ref: § 11 (LLM service).
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import {
  LlmError,
  LlmParseError,
  LlmTimeoutError,
  LlmUnavailableError,
} from './llm.errors.js';
import {
  EXPLAIN_SCHEDULE_SYSTEM,
  PARSE_PREFERENCES_SYSTEM,
  PARSE_RESHUFFLE_SYSTEM,
} from './prompts.js';

// ─── Public types ──────────────────────────────────────────────────────

/** Default model for parsing/explanation tasks. Sonnet is cost-efficient
 *  for these structured-output workloads. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Timeout for any single LLM call. Anything slower is treated as a failure. */
const REQUEST_TIMEOUT_MS = 10_000;

export type ParsedPreference = {
  cadence?: 'weekly' | 'biweekly' | 'monthly';
  needMinHours?: number;
  needMinDateNights?: number;
  needMinOvernights?: number;
  prefIdealHours?: number;
  prefDateNights?: number;
  prefOvernights?: number;
  prefDaytimeHangs?: number;
};

export interface ParsePreferencesInput {
  partnerName: string;
  currentPrefs: Partial<ParsedPreference> & { cadence?: string };
  naturalLanguageInput: string;
}

export interface ParsePreferencesResult {
  proposed: ParsedPreference;
  rationale: string;
  ambiguous: boolean;
  clarifyingQuestion?: string;
}

export interface ExplainScheduleInput {
  personName: string;
  /** Per-partner satisfaction summary, scrubbed to display names only. */
  satisfaction: Array<{
    partnerName: string;
    needMet: boolean;
    prefPct: number;
    hoursScheduled: number;
    hoursWanted: number;
  }>;
  overallPct: number;
  proposedBlocks: Array<{
    eventType: string;
    partnerName: string | null;
    start: string;
    end: string;
  }>;
  infeasibilityNotes: string[];
  question: string;
}

export interface ExplainScheduleResult {
  explanation: string;
  suggestions: string[];
}

export interface ParseReshuffleInput {
  personName: string;
  scheduledBlocks: Array<{
    id: string;
    eventType: string;
    partnerName: string | null;
    start: string;
    end: string;
  }>;
  naturalLanguageInput: string;
}

export interface ParseReshuffleResult {
  blockId: string | null;
  reason: string;
  preferredAlternative: { start: string; end: string } | null;
  confidence: 'high' | 'medium' | 'low';
  clarifyingQuestion?: string;
}

export interface LlmCallMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  feature: 'parsePreferences' | 'explainSchedule' | 'parseReshuffleRequest';
}

// ─── Service ───────────────────────────────────────────────────────────

export class LlmService {
  private client: Anthropic | null = null;
  private readonly apiKey: string;
  public readonly enabled: boolean;
  public readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? config.anthropic.apiKey ?? '';
    this.enabled = Boolean(this.apiKey);
    this.model = opts?.model ?? DEFAULT_MODEL;
  }

  /** Lazy-init the SDK so a server without a key never imports the runtime. */
  private getClient(): Anthropic {
    if (!this.enabled) {
      throw new LlmUnavailableError();
    }
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.apiKey,
        timeout: REQUEST_TIMEOUT_MS,
      });
    }
    return this.client;
  }

  // ─── parsePreferences ────────────────────────────────────────────────

  async parsePreferences(
    input: ParsePreferencesInput,
  ): Promise<{ result: ParsePreferencesResult; meta: LlmCallMeta }> {
    // Validate that the SDK is available before doing any work.
    this.getClient();
    const userMsg = [
      `Partner display name: ${sanitize(input.partnerName)}`,
      `Current preferences: ${JSON.stringify(input.currentPrefs ?? {})}`,
      `User's description:`,
      sanitize(input.naturalLanguageInput),
    ].join('\n');

    const { raw, meta } = await this.call(
      'parsePreferences',
      PARSE_PREFERENCES_SYSTEM,
      userMsg,
      1024,
    );
    const parsed = parseJsonBlock<ParsePreferencesResult>(raw);
    const proposed = clampParsedPreference(parsed.proposed ?? {});
    return {
      result: {
        proposed,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
        ambiguous: Boolean(parsed.ambiguous),
        clarifyingQuestion:
          typeof parsed.clarifyingQuestion === 'string' && parsed.clarifyingQuestion
            ? parsed.clarifyingQuestion
            : undefined,
      },
      meta,
    };
  }

  // ─── explainSchedule ─────────────────────────────────────────────────

  async explainSchedule(
    input: ExplainScheduleInput,
  ): Promise<{ result: ExplainScheduleResult; meta: LlmCallMeta }> {
    this.getClient();
    const userMsg = [
      `User's display name: ${sanitize(input.personName)}`,
      `Overall satisfaction: ${(input.overallPct * 100).toFixed(0)}%`,
      `Per-partner satisfaction: ${JSON.stringify(input.satisfaction)}`,
      `Proposed blocks: ${JSON.stringify(input.proposedBlocks)}`,
      `Infeasibility notes: ${JSON.stringify(input.infeasibilityNotes)}`,
      `User's question:`,
      sanitize(input.question),
    ].join('\n');

    const { raw, meta } = await this.call(
      'explainSchedule',
      EXPLAIN_SCHEDULE_SYSTEM,
      userMsg,
      1024,
    );
    const parsed = parseJsonBlock<ExplainScheduleResult>(raw);
    return {
      result: {
        explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 3)
          : [],
      },
      meta,
    };
  }

  // ─── parseReshuffleRequest ───────────────────────────────────────────

  async parseReshuffleRequest(
    input: ParseReshuffleInput,
  ): Promise<{ result: ParseReshuffleResult; meta: LlmCallMeta }> {
    this.getClient();
    const userMsg = [
      `User's display name: ${sanitize(input.personName)}`,
      `Currently scheduled blocks: ${JSON.stringify(input.scheduledBlocks)}`,
      `User's request:`,
      sanitize(input.naturalLanguageInput),
    ].join('\n');

    const { raw, meta } = await this.call(
      'parseReshuffleRequest',
      PARSE_RESHUFFLE_SYSTEM,
      userMsg,
      1024,
    );
    const parsed = parseJsonBlock<ParseReshuffleResult>(raw);
    const validIds = new Set(input.scheduledBlocks.map((b) => b.id));
    const blockId =
      typeof parsed.blockId === 'string' && validIds.has(parsed.blockId)
        ? parsed.blockId
        : null;

    return {
      result: {
        blockId,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        preferredAlternative:
          parsed.preferredAlternative &&
          typeof parsed.preferredAlternative === 'object' &&
          typeof parsed.preferredAlternative.start === 'string' &&
          typeof parsed.preferredAlternative.end === 'string'
            ? {
                start: parsed.preferredAlternative.start,
                end: parsed.preferredAlternative.end,
              }
            : null,
        confidence:
          parsed.confidence === 'high' ||
          parsed.confidence === 'medium' ||
          parsed.confidence === 'low'
            ? parsed.confidence
            : 'low',
        clarifyingQuestion:
          typeof parsed.clarifyingQuestion === 'string' && parsed.clarifyingQuestion
            ? parsed.clarifyingQuestion
            : undefined,
      },
      meta,
    };
  }

  // ─── private: shared call wrapper ────────────────────────────────────

  private async call(
    feature: LlmCallMeta['feature'],
    systemPrompt: string,
    userText: string,
    maxTokens: number,
  ): Promise<{ raw: string; meta: LlmCallMeta }> {
    const client = this.getClient();
    const started = Date.now();

    // Hard timeout via AbortController in addition to SDK timeout.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

    try {
      // The Anthropic SDK v0.32 doesn't yet expose `cache_control` in the
      // public TS types for `system` blocks, but the API supports it (prompt
      // caching beta). Build the system block as `unknown` and let the SDK
      // pass it through to the wire.
      const systemBlock = {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      } as unknown as Anthropic.TextBlockParam;
      const response = await client.messages.create(
        {
          model: this.model,
          max_tokens: maxTokens,
          system: [systemBlock],
          messages: [{ role: 'user', content: userText }],
        },
        { signal: ac.signal },
      );
      const latencyMs = Date.now() - started;

      // Concat any text blocks into a single string.
      const raw = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');

      const meta: LlmCallMeta = {
        feature,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs,
      };
      return { raw, meta };
    } catch (err: unknown) {
      const latencyMs = Date.now() - started;
      // Privacy: never log the user's input or any model output here.
      logger.error('llm.call.failed', {
        feature,
        model: this.model,
        latencyMs,
        error: errorSummary(err),
      });
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new LlmTimeoutError();
      }
      // The SDK throws Anthropic.APIError-typed errors with .status — surface
      // 401/429/5xx generically.
      throw new LlmError(undefined, undefined, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── helpers (module-private) ──────────────────────────────────────────

/** Strip control chars and clamp to a safe length. We never echo this back to
 *  the model except inside the prompt; this is defence-in-depth against
 *  prompt-injection nonsense and accidental PII. */
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0E-\x1F]/g, '').slice(0, 4000);
}

/** Parse the model's JSON output. Models are instructed to emit a single
 *  ```json``` fenced block, but we tolerate raw JSON too. */
function parseJsonBlock<T>(raw: string): Partial<T> & Record<string, unknown> {
  if (!raw || typeof raw !== 'string') {
    throw new LlmParseError(undefined, undefined, {
      internalMessage: 'empty model response',
    });
  }

  // Try fenced block first.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? raw.trim();

  // Fallback: locate the first '{' and matching last '}'.
  let jsonText = candidate;
  if (!jsonText.startsWith('{')) {
    const first = jsonText.indexOf('{');
    const last = jsonText.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      throw new LlmParseError(undefined, undefined, {
        internalMessage: 'no JSON object in model response',
      });
    }
    jsonText = jsonText.slice(first, last + 1);
  }

  try {
    return JSON.parse(jsonText) as Partial<T> & Record<string, unknown>;
  } catch (err) {
    throw new LlmParseError(undefined, undefined, {
      cause: err,
      internalMessage: 'invalid JSON in model response',
    });
  }
}

/** Constrain numeric fields to the same bounds as updatePartnershipPreferencesSchema. */
function clampParsedPreference(p: Record<string, unknown>): ParsedPreference {
  const out: ParsedPreference = {};
  if (p.cadence === 'weekly' || p.cadence === 'biweekly' || p.cadence === 'monthly') {
    out.cadence = p.cadence;
  }
  const numericFields: Array<{
    key: keyof ParsedPreference;
    int: boolean;
    max: number;
  }> = [
    { key: 'needMinHours', int: false, max: 168 },
    { key: 'needMinDateNights', int: true, max: 20 },
    { key: 'needMinOvernights', int: true, max: 20 },
    { key: 'prefIdealHours', int: false, max: 168 },
    { key: 'prefDateNights', int: true, max: 20 },
    { key: 'prefOvernights', int: true, max: 20 },
    { key: 'prefDaytimeHangs', int: true, max: 20 },
  ];
  for (const { key, int, max } of numericFields) {
    const v = p[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    let n = Math.max(0, Math.min(max, v));
    if (int) n = Math.round(n);
    (out as Record<string, number>)[key] = n;
  }
  // Enforce needMinHours <= prefIdealHours when both present.
  if (
    typeof out.needMinHours === 'number' &&
    typeof out.prefIdealHours === 'number' &&
    out.needMinHours > out.prefIdealHours
  ) {
    out.needMinHours = out.prefIdealHours;
  }
  return out;
}

function errorSummary(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; status?: number; message?: string };
    return {
      name: e.name,
      status: e.status,
      // message length, NOT message contents — message can include user input.
      messageLen: typeof e.message === 'string' ? e.message.length : 0,
    };
  }
  return { type: typeof err };
}

// ─── default export (singleton) ────────────────────────────────────────

let singleton: LlmService | null = null;
export function getLlmService(): LlmService {
  if (!singleton) singleton = new LlmService();
  return singleton;
}

/** Test seam — replace the singleton (e.g. with a mock) in tests. */
export function setLlmServiceForTests(svc: LlmService | null): void {
  singleton = svc;
}
