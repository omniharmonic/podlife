/**
 * AI / LLM-powered routes (Phase 8).
 *
 * All routes require authentication (mounted under the auth middleware in
 * app.ts) and degrade gracefully when ANTHROPIC_API_KEY is unset:
 *   - features endpoint reports `ai: false`
 *   - any AI-using route returns 503 with LlmUnavailableError
 *
 * Privacy invariants enforced here:
 *   - parsePreferences only sees the partner's display name (no email/UUIDs).
 *   - explainSchedule only sees the requester's own blocks + per-partner
 *     satisfaction, scrubbed to display names.
 *   - parseReshuffleRequest only sees blocks the requester participates in.
 *   - All access checks happen BEFORE any LLM call (so we never leak data
 *     into a model the requester can't see).
 *   - Every LLM call writes an audit_log row with action='llm_call' and
 *     metadata={feature, model, tokens, latency_ms}. Raw input/output is
 *     NEVER logged.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { updatePartnershipPreferencesSchema } from '@pod-life/shared';
import { db } from '../../db/index.js';
import {
  auditLog,
  partnerships,
  persons,
  schedulingCycles,
  timeBlockParticipants,
  timeBlocks,
} from '../../db/schema.js';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  getMyPreferences,
  updateMyPreferences,
} from '../partners/partners.service.js';
import {
  getLlmService,
  type LlmCallMeta,
} from '../../services/llm/llm.service.js';

// ─── Validation schemas (route-local) ──────────────────────────────────

const naturalInputSchema = z.object({
  input: z.string().min(1).max(2000),
});

const explainInputSchema = z.object({
  question: z.string().min(1).max(1000),
  cycleId: z.string().uuid().optional(),
});

const reshuffleConfirmSchema = z.object({
  blockId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  preferredAlternative: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
});

// ─── Routers ───────────────────────────────────────────────────────────

/** Mounted at the API root (under requireAuth). */
export const aiPartnerRoutes = new Hono();

aiPartnerRoutes.post(
  '/partners/:id/preferences/natural',
  zValidator('json', naturalInputSchema),
  async (c) => {
    const me = c.get('person');
    const partnershipId = c.req.param('id');
    const { input } = c.req.valid('json');

    // Resolve partnership + assert membership + look up partner display name.
    const { partner, currentPrefs } = await loadPartnershipContext(
      me.id,
      partnershipId,
    );

    const llm = getLlmService();
    const { result, meta } = await llm.parsePreferences({
      partnerName: partner.displayName,
      currentPrefs: {
        cadence: currentPrefs.cadence,
        needMinHours: currentPrefs.needMinHours,
        needMinDateNights: currentPrefs.needMinDateNights,
        needMinOvernights: currentPrefs.needMinOvernights,
        prefIdealHours: currentPrefs.prefIdealHours,
        prefDateNights: currentPrefs.prefDateNights,
        prefOvernights: currentPrefs.prefOvernights,
        prefDaytimeHangs: currentPrefs.prefDaytimeHangs,
      },
      naturalLanguageInput: input,
    });

    await writeLlmAudit(me.id, partnershipId, 'partnership', meta, {
      inputChars: input.length,
    });

    return c.json({
      proposed: result.proposed,
      currentPrefs,
      rationale: result.rationale,
      ambiguous: result.ambiguous,
      clarifyingQuestion: result.clarifyingQuestion ?? null,
    });
  },
);

aiPartnerRoutes.post(
  '/partners/:id/preferences/natural/confirm',
  zValidator('json', updatePartnershipPreferencesSchema),
  async (c) => {
    const me = c.get('person');
    const partnershipId = c.req.param('id');
    const data = c.req.valid('json');
    // Re-uses the existing partner-prefs patch service (which performs
    // partnership-membership authorization).
    const prefs = await updateMyPreferences(me.id, partnershipId, data);
    return c.json({ preferences: prefs });
  },
);

/** Mounted at the API root (under /schedule). */
export const aiScheduleRoutes = new Hono();

aiScheduleRoutes.post(
  '/explain',
  zValidator('json', explainInputSchema),
  async (c) => {
    const me = c.get('person');
    const { question, cycleId } = c.req.valid('json');

    const ctx = await loadExplainContext(me.id, cycleId);

    const llm = getLlmService();
    const { result, meta } = await llm.explainSchedule({
      personName: me.displayName,
      satisfaction: ctx.satisfaction,
      overallPct: ctx.overallPct,
      proposedBlocks: ctx.blocks,
      infeasibilityNotes: ctx.infeasibilityNotes,
      question,
    });

    await writeLlmAudit(me.id, ctx.cycleId, 'cycle', meta, {
      inputChars: question.length,
    });

    return c.json({
      explanation: result.explanation,
      suggestions: result.suggestions,
    });
  },
);

aiScheduleRoutes.post(
  '/reshuffle/natural',
  zValidator('json', naturalInputSchema),
  async (c) => {
    const me = c.get('person');
    const { input } = c.req.valid('json');

    const blocks = await loadReshuffleCandidates(me.id);

    const llm = getLlmService();
    const { result, meta } = await llm.parseReshuffleRequest({
      personName: me.displayName,
      scheduledBlocks: blocks,
      naturalLanguageInput: input,
    });

    await writeLlmAudit(me.id, null, 'schedule', meta, {
      inputChars: input.length,
    });

    // Return the parsed intent + the candidate block details so the UI can
    // render a confirmation card. We return only the chosen block (privacy:
    // already filtered to me's blocks, but no need to send the whole list).
    const candidateBlock = result.blockId
      ? blocks.find((b) => b.id === result.blockId) ?? null
      : null;

    return c.json({
      blockId: result.blockId,
      reason: result.reason,
      preferredAlternative: result.preferredAlternative,
      confidence: result.confidence,
      clarifyingQuestion: result.clarifyingQuestion ?? null,
      candidateBlock,
    });
  },
);

aiScheduleRoutes.post(
  '/reshuffle/natural/confirm',
  zValidator('json', reshuffleConfirmSchema),
  async (c) => {
    const me = c.get('person');
    const data = c.req.valid('json');

    // Verify the user actually participates in this block (privacy +
    // authorization). Re-uses the same scope as the existing /schedule/reshuffle
    // route logic in modules/schedule.
    const partRows = await db
      .select()
      .from(timeBlockParticipants)
      .where(
        and(
          eq(timeBlockParticipants.timeBlockId, data.blockId),
          eq(timeBlockParticipants.personId, me.id),
        ),
      )
      .limit(1);
    if (!partRows[0]) throw new NotFoundError('Block not found');

    // Lazy import the cycle manager + reshuffle status update to avoid a hard
    // dependency between the AI module and the schedule module at file load.
    const { triggerCycle } = await import('../schedule/cycle.manager.js');

    const [updated] = await db
      .update(timeBlocks)
      .set({ status: 'reshuffled' })
      .where(eq(timeBlocks.id, data.blockId))
      .returning();
    if (!updated) throw new NotFoundError('Block not found');

    const out = await triggerCycle({
      personId: me.id,
      triggerType: 'reshuffle',
    });
    return c.json({ ...out, reason: data.reason });
  },
);

// ─── /api/me/features (always available) ───────────────────────────────

export const featuresRoutes = new Hono();

featuresRoutes.get('/me/features', (c) => {
  return c.json({
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
});

// ─── helpers ───────────────────────────────────────────────────────────

async function loadPartnershipContext(
  personId: string,
  partnershipId: string,
): Promise<{
  partner: { id: string; displayName: string };
  currentPrefs: Awaited<ReturnType<typeof getMyPreferences>>;
}> {
  const rows = await db
    .select({ p: partnerships, otherA: persons })
    .from(partnerships)
    .leftJoin(persons, eq(persons.id, partnerships.personAId))
    .where(eq(partnerships.id, partnershipId))
    .limit(1);
  const r = rows[0];
  if (!r || !r.p) throw new NotFoundError('Partnership not found');
  if (r.p.personAId !== personId && r.p.personBId !== personId) {
    throw new ForbiddenError('Not a member of this partnership');
  }
  const partnerId = r.p.personAId === personId ? r.p.personBId : r.p.personAId;
  const partnerRows = await db
    .select({ id: persons.id, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, partnerId))
    .limit(1);
  const partner = partnerRows[0];
  if (!partner) throw new NotFoundError('Partner not found');

  const currentPrefs = await getMyPreferences(personId, partnershipId);
  return { partner, currentPrefs };
}

interface ExplainContext {
  cycleId: string;
  blocks: Array<{
    eventType: string;
    partnerName: string | null;
    start: string;
    end: string;
  }>;
  satisfaction: Array<{
    partnerName: string;
    needMet: boolean;
    prefPct: number;
    hoursScheduled: number;
    hoursWanted: number;
  }>;
  overallPct: number;
  infeasibilityNotes: string[];
}

async function loadExplainContext(
  personId: string,
  cycleIdOpt: string | undefined,
): Promise<ExplainContext> {
  // Resolve cycle: either the one requested (with auth check) or the latest
  // cycle the user is part of.
  let cycleRow:
    | { id: string; satisfactionReport: unknown; infeasibilityNotes: unknown }
    | undefined;
  if (cycleIdOpt) {
    const rows = await db
      .select({
        id: schedulingCycles.id,
        personIds: schedulingCycles.personIds,
        satisfactionReport: schedulingCycles.satisfactionReport,
        infeasibilityNotes: schedulingCycles.infeasibilityNotes,
      })
      .from(schedulingCycles)
      .where(eq(schedulingCycles.id, cycleIdOpt))
      .limit(1);
    const c = rows[0];
    if (!c) throw new NotFoundError('Cycle not found');
    if (!c.personIds.includes(personId)) {
      throw new ForbiddenError('Not part of this cycle');
    }
    cycleRow = c;
  } else {
    // Latest cycle the user belongs to.
    const rows = await db
      .select({
        id: schedulingCycles.id,
        satisfactionReport: schedulingCycles.satisfactionReport,
        infeasibilityNotes: schedulingCycles.infeasibilityNotes,
        personIds: schedulingCycles.personIds,
        createdAt: schedulingCycles.createdAt,
      })
      .from(schedulingCycles)
      .orderBy(schedulingCycles.createdAt);
    const mine = rows.filter((r) => r.personIds.includes(personId));
    cycleRow = mine[mine.length - 1];
    if (!cycleRow) {
      throw new NotFoundError(
        'No scheduling cycle yet — run a cycle first to get an explanation.',
      );
    }
  }

  // Pull only blocks the user participates in.
  const blockRows = await db
    .select({
      tb: timeBlocks,
      part: timeBlockParticipants,
    })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, personId),
        eq(timeBlocks.cycleId, cycleRow.id),
      ),
    );

  // For each block, resolve the partner display name (the OTHER person in
  // the partnership, if any).
  const partnershipIds = Array.from(
    new Set(blockRows.map((r) => r.tb.partnershipId).filter((x): x is string => !!x)),
  );
  const partnerMap = new Map<string, string>(); // partnershipId -> partner display name
  if (partnershipIds.length > 0) {
    const psRows = await db
      .select()
      .from(partnerships)
      .where(inArray(partnerships.id, partnershipIds));
    const otherIds = psRows.map((p) =>
      p.personAId === personId ? p.personBId : p.personAId,
    );
    const personRows = await db
      .select({ id: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(inArray(persons.id, otherIds));
    const idToName = new Map(personRows.map((p) => [p.id, p.displayName]));
    for (const p of psRows) {
      const otherId = p.personAId === personId ? p.personBId : p.personAId;
      const name = idToName.get(otherId);
      if (name) partnerMap.set(p.id, name);
    }
  }

  const blocks = blockRows.map(({ tb }) => ({
    eventType: tb.eventType,
    partnerName: tb.partnershipId ? partnerMap.get(tb.partnershipId) ?? null : null,
    start: tb.startTime.toISOString(),
    end: tb.endTime.toISOString(),
  }));

  // Build satisfaction summary scrubbed to display names only.
  type SatRow = {
    person_id: string;
    overall_pct: number;
    per_partner: Record<
      string,
      { need_met: boolean; pref_pct: number; hours_scheduled: number; hours_wanted: number }
    >;
  };
  const reports = Array.isArray(cycleRow.satisfactionReport)
    ? (cycleRow.satisfactionReport as SatRow[])
    : [];
  const mine = reports.find((r) => r.person_id === personId);
  const satisfaction: ExplainContext['satisfaction'] = [];
  let overallPct = 0;
  if (mine) {
    overallPct = mine.overall_pct ?? 0;
    const otherIds = Object.keys(mine.per_partner ?? {});
    const personRows = otherIds.length
      ? await db
          .select({ id: persons.id, displayName: persons.displayName })
          .from(persons)
          .where(inArray(persons.id, otherIds))
      : [];
    const idToName = new Map(personRows.map((p) => [p.id, p.displayName]));
    for (const [partnerId, stats] of Object.entries(mine.per_partner ?? {})) {
      satisfaction.push({
        partnerName: idToName.get(partnerId) ?? 'a partner',
        needMet: Boolean(stats.need_met),
        prefPct: Number(stats.pref_pct ?? 0),
        hoursScheduled: Number(stats.hours_scheduled ?? 0),
        hoursWanted: Number(stats.hours_wanted ?? 0),
      });
    }
  }

  const infeasibilityNotes = Array.isArray(cycleRow.infeasibilityNotes)
    ? (cycleRow.infeasibilityNotes as unknown[])
        .filter((n): n is string => typeof n === 'string')
        .slice(0, 8)
    : [];

  return {
    cycleId: cycleRow.id,
    blocks,
    satisfaction,
    overallPct,
    infeasibilityNotes,
  };
}

async function loadReshuffleCandidates(
  personId: string,
): Promise<
  Array<{
    id: string;
    eventType: string;
    partnerName: string | null;
    start: string;
    end: string;
  }>
> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const rows = await db
    .select({ tb: timeBlocks })
    .from(timeBlockParticipants)
    .innerJoin(timeBlocks, eq(timeBlocks.id, timeBlockParticipants.timeBlockId))
    .where(
      and(
        eq(timeBlockParticipants.personId, personId),
        inArray(timeBlocks.status, ['proposed', 'accepted', 'locked'] as const),
        gte(timeBlocks.endTime, now),
        lte(timeBlocks.startTime, horizon),
      ),
    );

  const partnershipIds = Array.from(
    new Set(rows.map((r) => r.tb.partnershipId).filter((x): x is string => !!x)),
  );
  const partnerMap = new Map<string, string>();
  if (partnershipIds.length > 0) {
    const psRows = await db
      .select()
      .from(partnerships)
      .where(
        and(
          inArray(partnerships.id, partnershipIds),
          or(eq(partnerships.personAId, personId), eq(partnerships.personBId, personId)),
        ),
      );
    const otherIds = psRows.map((p) =>
      p.personAId === personId ? p.personBId : p.personAId,
    );
    const personRows = await db
      .select({ id: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(inArray(persons.id, otherIds));
    const idToName = new Map(personRows.map((p) => [p.id, p.displayName]));
    for (const p of psRows) {
      const otherId = p.personAId === personId ? p.personBId : p.personAId;
      const name = idToName.get(otherId);
      if (name) partnerMap.set(p.id, name);
    }
  }

  return rows.map(({ tb }) => ({
    id: tb.id,
    eventType: tb.eventType,
    partnerName: tb.partnershipId ? partnerMap.get(tb.partnershipId) ?? null : null,
    start: tb.startTime.toISOString(),
    end: tb.endTime.toISOString(),
  }));
}

async function writeLlmAudit(
  personId: string,
  resourceId: string | null,
  resourceType: string,
  meta: LlmCallMeta,
  extras: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      personId,
      action: 'llm_call',
      resourceType,
      resourceId,
      metadata: {
        feature: meta.feature,
        model: meta.model,
        input_tokens: meta.inputTokens,
        output_tokens: meta.outputTokens,
        latency_ms: meta.latencyMs,
        ...extras,
      },
    });
  } catch (err) {
    // Audit failures must never break the user request — log and continue.
    logger.error('audit.llm_call.failed', {
      feature: meta.feature,
      error: err instanceof Error ? err.name : 'unknown',
    });
  }
}

// Suppress "imported but unused" on ValidationError — kept available for
// future fine-grained validation in the routes above.
void ValidationError;
