/**
 * Multi-pod stress runner.
 *
 * Builds a 15-person polycule across four overlapping pods with deliberately
 * varied configurations (timezones, hour preferences, date-night needs,
 * available windows) and then drives the real cycle pipeline against it.
 * Three scenarios run against the same seeded world:
 *
 *   1. Sequential — each pod's cycle runs to completion before the next
 *      starts. Each cycle sees prior cycles' LOCKED blocks (none yet,
 *      since participants haven't accepted), but proposed blocks from
 *      earlier cycles are NOT visible to later ones. We lock all
 *      proposals between cycles to simulate "everyone accepts" and
 *      observe the cumulative satisfaction.
 *
 *   2. Concurrent — all four pods' cycles trigger via Promise.all so
 *      they execute in parallel. This is the cycle-timing concern the
 *      product surfaced: overlapping members appear in multiple pods,
 *      and parallel cycles can both propose into the same window.
 *
 *   3. Staggered with cross-cycle locks — first cycle proposes, all
 *      participants accept (LOCK), then second cycle runs and should
 *      see the locked windows as busy. Repeats across pods. This is
 *      the well-behaved case.
 *
 * The runner produces a markdown report at apps/api/scripts/e2e-stress-report.md
 * summarizing what happened.
 *
 * Run with:
 *   pnpm --filter @pod-life/api e2e:stress
 */

import 'dotenv/config';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Load monorepo .env so DATABASE_URL etc. are available.
loadDotenv({ path: resolve(__dirname, '../../../.env') });

import { db } from '../src/db/index.js';
import {
  persons,
  partnerships,
  partnershipPreferences,
  pods,
  podMembers,
  podPreferences,
  manualAvailability,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
  auditLog,
} from '../src/db/schema.js';
import {
  computeHorizon,
  getInvolvedPersonIds,
  processCycleJob,
} from '../src/modules/schedule/cycle.manager.js';

// ─── World definition ────────────────────────────────────────────────

interface SeedPerson {
  email: string;
  displayName: string;
  timezone: string;
}

interface SeedPartnership {
  a: string; // displayName key
  b: string;
  prefHours: number; // pref ideal per side
  needHours: number;
  dateNights: number;
}

interface SeedPod {
  name: string;
  emoji: string;
  members: string[]; // displayName keys
  /** Min monthly pod gatherings (informational; we set frequency cap=1/cycle). */
  monthlyGatherings: number;
}

const PEOPLE: SeedPerson[] = [
  { email: 'stress-a@podlife.local', displayName: 'Aurelius', timezone: 'America/Denver' },
  { email: 'stress-b@podlife.local', displayName: 'Beatrix', timezone: 'America/Denver' },
  { email: 'stress-c@podlife.local', displayName: 'Cassian', timezone: 'America/Denver' },
  { email: 'stress-d@podlife.local', displayName: 'Delphine', timezone: 'America/Denver' },
  { email: 'stress-e@podlife.local', displayName: 'Elias', timezone: 'America/New_York' },
  { email: 'stress-f@podlife.local', displayName: 'Florence', timezone: 'America/New_York' },
  { email: 'stress-g@podlife.local', displayName: 'Gareth', timezone: 'America/New_York' },
  { email: 'stress-h@podlife.local', displayName: 'Hadley', timezone: 'America/New_York' },
  { email: 'stress-i@podlife.local', displayName: 'Imogen', timezone: 'Europe/London' },
  { email: 'stress-j@podlife.local', displayName: 'Jasper', timezone: 'Europe/London' },
  { email: 'stress-k@podlife.local', displayName: 'Kestrel', timezone: 'Europe/London' },
  { email: 'stress-l@podlife.local', displayName: 'Linnea', timezone: 'America/Denver' },
  { email: 'stress-m@podlife.local', displayName: 'Mireille', timezone: 'America/Los_Angeles' },
  { email: 'stress-n@podlife.local', displayName: 'Nikolai', timezone: 'America/Los_Angeles' },
  { email: 'stress-o@podlife.local', displayName: 'Octavia', timezone: 'America/Denver' },
];

// 15 partnerships forming a non-trivial graph: a tight core, two side
// households, and several solo-poly bridges. The intent is to make the
// scheduler's life hard — not impossible, but it has to compromise.
const PARTNERSHIPS: SeedPartnership[] = [
  // Core household (Aurelius–Beatrix–Cassian–Delphine all mutually partnered)
  { a: 'Aurelius', b: 'Beatrix', prefHours: 6, needHours: 3, dateNights: 1 },
  { a: 'Aurelius', b: 'Cassian', prefHours: 5, needHours: 2, dateNights: 1 },
  { a: 'Aurelius', b: 'Delphine', prefHours: 4, needHours: 2, dateNights: 1 },
  { a: 'Beatrix', b: 'Cassian', prefHours: 5, needHours: 2, dateNights: 1 },
  // Beatrix's outside partners
  { a: 'Beatrix', b: 'Elias', prefHours: 8, needHours: 4, dateNights: 2 },
  { a: 'Beatrix', b: 'Octavia', prefHours: 4, needHours: 2, dateNights: 1 },
  // Cassian's outside partner
  { a: 'Cassian', b: 'Gareth', prefHours: 6, needHours: 3, dateNights: 1 },
  // Aurelius's outside partner
  { a: 'Aurelius', b: 'Florence', prefHours: 7, needHours: 4, dateNights: 2 },
  // Cross-household connections
  { a: 'Florence', b: 'Hadley', prefHours: 5, needHours: 2, dateNights: 1 },
  { a: 'Delphine', b: 'Jasper', prefHours: 3, needHours: 1, dateNights: 0 },
  // Second household triad
  { a: 'Hadley', b: 'Imogen', prefHours: 6, needHours: 3, dateNights: 1 },
  { a: 'Imogen', b: 'Jasper', prefHours: 5, needHours: 2, dateNights: 1 },
  // Solo-poly cluster
  { a: 'Kestrel', b: 'Linnea', prefHours: 4, needHours: 2, dateNights: 1 },
  { a: 'Kestrel', b: 'Mireille', prefHours: 5, needHours: 2, dateNights: 1 },
  { a: 'Linnea', b: 'Nikolai', prefHours: 4, needHours: 2, dateNights: 1 },
];

// Four pods with overlapping membership. Aurelius, Beatrix, Florence, and
// Hadley each appear in 2+ pods — that's where cycle-timing collisions get
// interesting.
const PODS: SeedPod[] = [
  { name: 'Hearth',  emoji: '🏠', members: ['Aurelius', 'Beatrix', 'Cassian', 'Delphine'], monthlyGatherings: 4 },
  { name: 'Garden',  emoji: '🌿', members: ['Florence', 'Hadley', 'Imogen', 'Jasper'],     monthlyGatherings: 2 },
  { name: 'Volume',  emoji: '✨', members: ['Kestrel', 'Linnea', 'Mireille', 'Nikolai'],   monthlyGatherings: 2 },
  // "Council" — bridge pod with members from each of the other three.
  { name: 'Council', emoji: '🌳', members: ['Aurelius', 'Florence', 'Hadley', 'Kestrel', 'Beatrix'], monthlyGatherings: 1 },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function findPersonId(byName: Map<string, string>, name: string): string {
  const id = byName.get(name);
  if (!id) throw new Error(`unknown seed person ${name}`);
  return id;
}

/** Sort two UUIDs ascending so partnership rows respect the canonical
 *  ordering CHECK (CLAUDE.md gotcha #1). */
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function nukeStressData(): Promise<void> {
  const emails = PEOPLE.map((p) => p.email);
  const existing = await db.select().from(persons).where(inArray(persons.email, emails));
  if (existing.length === 0) return;
  const ids = existing.map((p) => p.id);
  // Clear FKs without ON DELETE CASCADE first.
  const podsCreated = await db.select().from(pods).where(inArray(pods.createdBy, ids));
  if (podsCreated.length > 0) {
    await db.delete(pods).where(inArray(pods.id, podsCreated.map((p) => p.id)));
  }
  await db.update(auditLog).set({ personId: null }).where(inArray(auditLog.personId, ids));
  await db.update(schedulingCycles).set({ triggeredBy: null }).where(inArray(schedulingCycles.triggeredBy, ids));
  await db.delete(persons).where(inArray(persons.id, ids));
}

/**
 * Seed the world. Returns a name→id map for downstream use.
 */
async function seedWorld(): Promise<{
  personIds: Map<string, string>;
  podIds: Map<string, string>;
  partnershipIds: Map<string, string>;
}> {
  await nukeStressData();

  // 1. People.
  const personIds = new Map<string, string>();
  for (const p of PEOPLE) {
    const [row] = await db
      .insert(persons)
      .values({
        email: p.email,
        displayName: p.displayName,
        timezone: p.timezone,
        onboardedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error(`failed to insert ${p.email}`);
    personIds.set(p.displayName, row.id);
  }

  // 2. Partnerships (canonically ordered).
  const partnershipIds = new Map<string, string>();
  for (const ps of PARTNERSHIPS) {
    const aId = findPersonId(personIds, ps.a);
    const bId = findPersonId(personIds, ps.b);
    const [first, second] = canonical(aId, bId);
    const [row] = await db
      .insert(partnerships)
      .values({
        personAId: first,
        personBId: second,
        invitedBy: aId,
        status: 'active',
        startedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error(`partnership insert failed for ${ps.a}/${ps.b}`);
    partnershipIds.set(`${ps.a}|${ps.b}`, row.id);

    // Both sides log identical preferences for simplicity (the optimizer
    // currently averages per-pair so symmetry is the default). When we
    // want asymmetric tests later, just write different rows.
    for (const owner of [aId, bId]) {
      await db.insert(partnershipPreferences).values({
        partnershipId: row.id,
        personId: owner,
        needMinHours: String(ps.needHours),
        prefIdealHours: String(ps.prefHours),
        needMinDateNights: ps.dateNights,
        prefDateNights: ps.dateNights,
      });
    }
  }

  // 3. Pods + members.
  const podIds = new Map<string, string>();
  for (const pd of PODS) {
    const creatorId = findPersonId(personIds, pd.members[0]!);
    const [row] = await db
      .insert(pods)
      .values({
        name: pd.name,
        emoji: pd.emoji,
        createdBy: creatorId,
        schedulingCadence: 'weekly',
      })
      .returning();
    if (!row) throw new Error(`pod insert failed for ${pd.name}`);
    podIds.set(pd.name, row.id);

    for (const m of pd.members) {
      const memberId = findPersonId(personIds, m);
      await db.insert(podMembers).values({
        podId: row.id,
        personId: memberId,
        role: m === pd.members[0] ? 'admin' : 'member',
        joinedAt: new Date(),
      });
    }

    // One gathering per cycle so each pod sometimes asks for shared time.
    await db.insert(podPreferences).values({
      podId: row.id,
      podGatheringsPerCycle: 1,
    });
  }

  // 4. Manual availability — varied evening windows per person.
  // Horizon is the next 7 days starting tomorrow at 00:00 UTC. We populate
  // each person's free windows using their local "evening" hours converted
  // back to UTC via the IANA timezone, plus a weekend daytime window.
  const tomorrowUTC = new Date();
  tomorrowUTC.setUTCHours(24, 0, 0, 0);

  for (const p of PEOPLE) {
    const personId = findPersonId(personIds, p.displayName);
    const windows = buildAvailabilityFor(p, tomorrowUTC);
    if (windows.length > 0) {
      await db.insert(manualAvailability).values(
        windows.map((w) => ({
          personId,
          startTime: new Date(w.start),
          endTime: new Date(w.end),
        })),
      );
    }
  }

  return { personIds, podIds, partnershipIds };
}

/**
 * Each person gets free windows across the 7-day horizon. The pattern
 * varies by person to prevent a "perfect overlap" trivial solve:
 *
 *  - Aurelius: lots of evenings (open scheduler)
 *  - Beatrix: only Tue/Thu evenings + weekend (heavy traveler)
 *  - Cassian: weekends only (works late on weekdays)
 *  - Delphine: every other evening
 *  - Florence: Mon/Wed/Fri + Sat
 *  - Hadley: weekday evenings only
 *  - Imogen/Jasper: limited overlap with US TZ partners
 *  - Kestrel/Linnea/Mireille/Nikolai: solo cluster has scattered windows
 *  - Octavia/Elias/Gareth: minimal availability (busy professionals)
 */
function buildAvailabilityFor(p: SeedPerson, tomorrowUTC: Date): { start: string; end: string }[] {
  // Day-of-cycle (0–6), eveningSlots, weekendDayHours
  // Each evening slot is 18:00–22:00 *local time*. We translate to UTC.
  type Pattern = { evenings: number[]; weekend?: boolean; eveningStart?: number; eveningEnd?: number };
  const PATTERNS: Record<string, Pattern> = {
    Aurelius: { evenings: [0, 1, 2, 3, 4, 5, 6], weekend: true },
    Beatrix:  { evenings: [1, 3, 5, 6], weekend: true },
    Cassian:  { evenings: [5, 6], weekend: true },
    Delphine: { evenings: [0, 2, 4, 6], weekend: true },
    Elias:    { evenings: [2, 4], weekend: false },
    Florence: { evenings: [0, 2, 4, 5], weekend: true },
    Gareth:   { evenings: [3], weekend: true },
    Hadley:   { evenings: [0, 1, 2, 3, 4], weekend: false },
    Imogen:   { evenings: [0, 1, 2, 3, 4, 5, 6], weekend: true, eveningStart: 19, eveningEnd: 22 },
    Jasper:   { evenings: [1, 3, 5, 6], weekend: true, eveningStart: 19, eveningEnd: 22 },
    Kestrel:  { evenings: [0, 2, 4, 6], weekend: true },
    Linnea:   { evenings: [1, 3, 5], weekend: true },
    Mireille: { evenings: [0, 1, 2, 3, 4, 5, 6], weekend: true },
    Nikolai:  { evenings: [2, 4, 6], weekend: true },
    Octavia:  { evenings: [3, 5], weekend: false },
  };

  const pat = PATTERNS[p.displayName];
  if (!pat) return [];

  const wins: { start: string; end: string }[] = [];
  const eveStart = pat.eveningStart ?? 17;
  const eveEnd = pat.eveningEnd ?? 22;

  for (const dayOffset of pat.evenings) {
    const dayUTC = new Date(tomorrowUTC.getTime() + dayOffset * 86_400_000);
    // Take the local eveningStart→eveningEnd hours and convert to UTC.
    const startLocal = localDateInZone(dayUTC, p.timezone, eveStart, 0);
    const endLocal = localDateInZone(dayUTC, p.timezone, eveEnd, 0);
    wins.push({ start: startLocal.toISOString(), end: endLocal.toISOString() });
  }

  if (pat.weekend) {
    // Saturday daytime in local time. Find the Saturday within the horizon.
    for (let d = 0; d < 7; d++) {
      const dayUTC = new Date(tomorrowUTC.getTime() + d * 86_400_000);
      const sat = isSaturdayInZone(dayUTC, p.timezone);
      if (sat) {
        const start = localDateInZone(dayUTC, p.timezone, 10, 0);
        const end = localDateInZone(dayUTC, p.timezone, 18, 0);
        wins.push({ start: start.toISOString(), end: end.toISOString() });
        break;
      }
    }
  }

  return wins;
}

/**
 * Build the UTC Date corresponding to a local wall-clock hour:minute on a
 * given UTC-aligned day in a particular IANA zone. Approximate (we don't
 * round to second), but accurate to the minute via Intl. Used for seeding
 * availability so timezone differences create real overlap challenges.
 */
function localDateInZone(dayUTC: Date, zone: string, hour: number, minute: number): Date {
  // Walk the Y/M/D as observed in `zone` for this UTC instant, then build
  // a UTC instant whose representation in `zone` lands on H:M. We do this
  // by: (a) probing the wall-clock at an arbitrary anchor in the zone,
  // (b) computing the offset, (c) shifting.
  const anchor = new Date(dayUTC.getTime());
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(anchor);
  const yyyy = Number(parts.find((p) => p.type === 'year')!.value);
  const mm = Number(parts.find((p) => p.type === 'month')!.value);
  const dd = Number(parts.find((p) => p.type === 'day')!.value);
  // Build the desired wall time as if the zone were UTC, then correct by
  // the zone offset.
  const wallUTC = Date.UTC(yyyy, mm - 1, dd, hour, minute, 0);
  const offset = zoneOffsetMs(new Date(wallUTC), zone);
  return new Date(wallUTC - offset);
}

/** ms that `zone` is ahead of UTC at the given instant (e.g. EST → -18000000). */
function zoneOffsetMs(at: Date, zone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(at);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asLocal = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asLocal - at.getTime();
}

function isSaturdayInZone(dayUTC: Date, zone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' });
  return fmt.format(dayUTC) === 'Sat';
}

// ─── Cycle scenarios ─────────────────────────────────────────────────

interface CycleOutcome {
  pod: string;
  cycleId: string;
  durationMs: number;
  proposed: number;
  satisfaction: { mean: number; min: number; below_need: number };
  infeasibility: number;
  collisions: { count: number; details: string[] };
}

interface ScenarioResult {
  name: string;
  totalMs: number;
  cycles: CycleOutcome[];
  globalCollisions: { proposed: number; locked: number };
}

async function runScenarioSequential(
  personIds: Map<string, string>,
  podIds: Map<string, string>,
): Promise<ScenarioResult> {
  console.log('\n=== SCENARIO 1: SEQUENTIAL — accept-between-cycles ===');
  const cycles: CycleOutcome[] = [];
  const t0 = Date.now();
  for (const [podName, podId] of podIds) {
    const triggererName = PODS.find((p) => p.name === podName)!.members[0]!;
    const triggererId = findPersonId(personIds, triggererName);
    const out = await runOnePodCycle(podName, podId, triggererId);
    cycles.push(out);
    // Lock everything this cycle proposed so the next cycle sees it as busy.
    await lockProposalsForCycle(out.cycleId);
  }
  const totalMs = Date.now() - t0;
  const collisions = await measureCollisions();
  return { name: 'sequential', totalMs, cycles, globalCollisions: collisions };
}

async function runScenarioConcurrent(
  personIds: Map<string, string>,
  podIds: Map<string, string>,
): Promise<ScenarioResult> {
  console.log('\n=== SCENARIO 2: CONCURRENT — all 4 pod cycles in parallel ===');
  const t0 = Date.now();
  const launched = await Promise.all(
    Array.from(podIds.entries()).map(async ([podName, podId]) => {
      const triggererName = PODS.find((p) => p.name === podName)!.members[0]!;
      const triggererId = findPersonId(personIds, triggererName);
      return runOnePodCycle(podName, podId, triggererId);
    }),
  );
  const totalMs = Date.now() - t0;
  const collisions = await measureCollisions();
  return { name: 'concurrent', totalMs, cycles: launched, globalCollisions: collisions };
}

async function runScenarioStaggered(
  personIds: Map<string, string>,
  podIds: Map<string, string>,
): Promise<ScenarioResult> {
  console.log('\n=== SCENARIO 3: STAGGERED — locked between, 5s apart ===');
  const cycles: CycleOutcome[] = [];
  const t0 = Date.now();
  for (const [podName, podId] of podIds) {
    const triggererName = PODS.find((p) => p.name === podName)!.members[0]!;
    const triggererId = findPersonId(personIds, triggererName);
    const out = await runOnePodCycle(podName, podId, triggererId);
    cycles.push(out);
    await lockProposalsForCycle(out.cycleId);
    await new Promise((r) => setTimeout(r, 250));
  }
  const totalMs = Date.now() - t0;
  const collisions = await measureCollisions();
  return { name: 'staggered', totalMs, cycles, globalCollisions: collisions };
}

async function runOnePodCycle(podName: string, podId: string, triggererId: string): Promise<CycleOutcome> {
  const t0 = Date.now();
  // Insert the cycle row directly (instead of triggerCycle, which would
  // also enqueue a BullMQ job and risk double-execution if a worker is
  // running). The synchronous processCycleJob below is the unit under
  // test for the stress runner.
  const involved = await getInvolvedPersonIds(triggererId, podId);
  const { start, end } = computeHorizon();
  const [cycle] = await db
    .insert(schedulingCycles)
    .values({
      status: 'collecting',
      horizonStart: start,
      horizonEnd: end,
      triggeredBy: triggererId,
      triggerType: 'manual',
      personIds: involved,
    })
    .returning();
  if (!cycle) throw new Error('failed to insert cycle row');
  const cycleId = cycle.id;

  const result = (await processCycleJob({ cycleId })) as {
    proposed?: number;
    notes?: string[];
  };
  const durationMs = Date.now() - t0;

  const proposed = await db
    .select()
    .from(timeBlocks)
    .where(eq(timeBlocks.cycleId, cycleId));

  const cycleRow = await db
    .select()
    .from(schedulingCycles)
    .where(eq(schedulingCycles.id, cycleId))
    .limit(1);
  const sat = (cycleRow[0]?.satisfactionReport ?? null) as
    | { person_id: string; overall_pct: number; need_met: boolean }[]
    | null;
  const infeas = (cycleRow[0]?.infeasibilityNotes ?? []) as string[];

  // overall_pct from the solver is on a 0–100 scale.
  let satMean = 100;
  let satMin = 100;
  let belowNeed = 0;
  if (sat && sat.length > 0) {
    satMean = sat.reduce((s, r) => s + r.overall_pct, 0) / sat.length;
    satMin = sat.reduce((s, r) => Math.min(s, r.overall_pct), 100);
    belowNeed = sat.filter((r) => !r.need_met).length;
  }

  const collisions = await detectInternalCollisions(cycleId);

  console.log(
    `  ${podName.padEnd(8)} cycle ${cycleId.slice(0, 8)}… → ` +
      `${proposed.length} blocks, sat μ=${satMean.toFixed(0)}% min=${satMin.toFixed(0)}%, ` +
      `${belowNeed} below-need, ${infeas.length} infeas, ` +
      `${collisions.count} self-collisions, ${durationMs}ms`,
  );
  void result;

  return {
    pod: podName,
    cycleId,
    durationMs,
    proposed: proposed.length,
    satisfaction: { mean: satMean, min: satMin, below_need: belowNeed },
    infeasibility: infeas.length,
    collisions,
  };
}

async function lockProposalsForCycle(cycleId: string): Promise<void> {
  const rows = await db.select().from(timeBlocks).where(eq(timeBlocks.cycleId, cycleId));
  for (const r of rows) {
    await db.update(timeBlocks).set({ status: 'locked' }).where(eq(timeBlocks.id, r.id));
    await db
      .update(timeBlockParticipants)
      .set({ response: 'accepted', respondedAt: new Date() })
      .where(eq(timeBlockParticipants.timeBlockId, r.id));
  }
}

async function detectInternalCollisions(cycleId: string): Promise<{ count: number; details: string[] }> {
  // Within a single cycle, the optimizer's no-double-booking constraint
  // should prevent any participant from being in two overlapping blocks.
  // If we find one, the constraint formulation has a bug.
  const rows = await db
    .select()
    .from(timeBlocks)
    .where(eq(timeBlocks.cycleId, cycleId));
  const parts = await db
    .select()
    .from(timeBlockParticipants)
    .where(inArray(timeBlockParticipants.timeBlockId, rows.map((r) => r.id)));
  const partsByBlock = new Map<string, string[]>();
  for (const p of parts) {
    const arr = partsByBlock.get(p.timeBlockId) ?? [];
    arr.push(p.personId);
    partsByBlock.set(p.timeBlockId, arr);
  }
  const details: string[] = [];
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.endTime <= b.startTime || b.endTime <= a.startTime) continue;
      const aP = new Set(partsByBlock.get(a.id) ?? []);
      const bP = partsByBlock.get(b.id) ?? [];
      const overlap = bP.filter((p) => aP.has(p));
      if (overlap.length > 0) {
        count++;
        details.push(
          `cycle ${cycleId.slice(0, 8)}: blocks ${a.id.slice(0, 8)} ↔ ${b.id.slice(0, 8)} share ${overlap.length} person(s)`,
        );
      }
    }
  }
  return { count, details };
}

async function measureCollisions(): Promise<{ proposed: number; locked: number }> {
  // Cross-cycle collisions across the *entire* DB. Picks up any time two
  // blocks (from different cycles) overlap and share a participant. This
  // is the real cycle-timing concern — the inline optimizer prevents
  // collisions within a cycle but not across.
  const rows = await db.select().from(timeBlocks);
  if (rows.length === 0) return { proposed: 0, locked: 0 };
  const parts = await db.select().from(timeBlockParticipants);
  const partsByBlock = new Map<string, string[]>();
  for (const p of parts) {
    const arr = partsByBlock.get(p.timeBlockId) ?? [];
    arr.push(p.personId);
    partsByBlock.set(p.timeBlockId, arr);
  }
  let proposed = 0;
  let locked = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.cycleId === b.cycleId) continue;
      if (a.endTime <= b.startTime || b.endTime <= a.startTime) continue;
      const aP = new Set(partsByBlock.get(a.id) ?? []);
      const bP = partsByBlock.get(b.id) ?? [];
      if (!bP.some((p) => aP.has(p))) continue;
      if (a.status === 'locked' && b.status === 'locked') locked++;
      else proposed++;
    }
  }
  return { proposed, locked };
}

async function clearAllProposalsAndCycles(): Promise<void> {
  // Wipe every cycle the stress runner created so each scenario starts
  // from a clean slate. Person rows + partnerships remain.
  const stressIds = (await db.select().from(persons).where(inArray(persons.email, PEOPLE.map((p) => p.email)))).map((p) => p.id);
  if (stressIds.length === 0) return;
  const cycles = await db
    .select()
    .from(schedulingCycles)
    .where(inArray(schedulingCycles.triggeredBy, stressIds));
  if (cycles.length === 0) return;
  const cycleIds = cycles.map((c) => c.id);
  const blocks = await db
    .select()
    .from(timeBlocks)
    .where(inArray(timeBlocks.cycleId, cycleIds));
  if (blocks.length > 0) {
    await db
      .delete(timeBlockParticipants)
      .where(inArray(timeBlockParticipants.timeBlockId, blocks.map((b) => b.id)));
    await db.delete(timeBlocks).where(inArray(timeBlocks.cycleId, cycleIds));
  }
  await db.delete(schedulingCycles).where(inArray(schedulingCycles.id, cycleIds));
}

// ─── Report ──────────────────────────────────────────────────────────

function renderReport(scenarios: ScenarioResult[]): string {
  const lines: string[] = [];
  lines.push('# Pod Life — Multi-Pod E2E Stress Report');
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push('');
  lines.push('## Polycule shape');
  lines.push(`- **People:** ${PEOPLE.length}`);
  lines.push(`- **Partnerships:** ${PARTNERSHIPS.length}`);
  lines.push(`- **Pods:** ${PODS.length} (${PODS.map((p) => p.name).join(', ')})`);
  const overlap = new Map<string, string[]>();
  for (const pd of PODS) for (const m of pd.members) {
    const arr = overlap.get(m) ?? [];
    arr.push(pd.name);
    overlap.set(m, arr);
  }
  const multiPodPeople = [...overlap.entries()].filter(([, ps]) => ps.length > 1);
  lines.push(`- **People in 2+ pods:** ${multiPodPeople.length} (${multiPodPeople.map(([n, ps]) => `${n} in ${ps.join('+')}`).join(', ')})`);
  lines.push(`- **Timezones:** ${[...new Set(PEOPLE.map((p) => p.timezone))].length} (${[...new Set(PEOPLE.map((p) => p.timezone))].join(', ')})`);
  lines.push('');

  for (const s of scenarios) {
    lines.push(`## Scenario: ${s.name}`);
    lines.push('');
    lines.push(`Total wall-clock: **${s.totalMs} ms**`);
    lines.push('');
    lines.push('| pod | proposed | sat μ | sat min | below-need | infeas | self-collisions | duration |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const c of s.cycles) {
      lines.push(
        `| ${c.pod} | ${c.proposed} | ${c.satisfaction.mean.toFixed(0)}% | ${c.satisfaction.min.toFixed(0)}% | ${c.satisfaction.below_need} | ${c.infeasibility} | ${c.collisions.count} | ${c.durationMs}ms |`,
      );
    }
    lines.push('');
    lines.push(`**Cross-cycle collisions:** ${s.globalCollisions.proposed} between proposed blocks, ${s.globalCollisions.locked} between locked blocks.`);
    lines.push('');
    if (s.cycles.some((c) => c.collisions.details.length > 0)) {
      lines.push('Self-collision details:');
      for (const c of s.cycles) for (const d of c.collisions.details) lines.push(`- ${d}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Seeding world…');
  const { personIds, podIds } = await seedWorld();
  console.log(`  ${personIds.size} people, ${PARTNERSHIPS.length} partnerships, ${podIds.size} pods`);

  const scenarios: ScenarioResult[] = [];
  scenarios.push(await runScenarioSequential(personIds, podIds));

  await clearAllProposalsAndCycles();
  scenarios.push(await runScenarioConcurrent(personIds, podIds));

  await clearAllProposalsAndCycles();
  scenarios.push(await runScenarioStaggered(personIds, podIds));

  const report = renderReport(scenarios);
  const reportPath = resolve(__dirname, 'e2e-stress-report.md');
  writeFileSync(reportPath, report, 'utf8');
  console.log(`\nReport written to ${reportPath}`);

  // Clean up — leaving 15 stress persons in the DB poisons the
  // telegram-privacy substring-match test (it saw "Beatrix" in the
  // persons table and rejected unrelated test messages mentioning
  // "Beatrice"). Restore the DB to a clean state on exit.
  await clearAllProposalsAndCycles();
  await nukeStressData();
  console.log('Stress data cleaned up.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('stress runner failed:', err);
    process.exit(1);
  },
);
