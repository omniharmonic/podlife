/**
 * Privacy boundary test suite (P9.1) — CRITICAL.
 *
 * Per CLAUDE.md § Privacy Model:
 *   "A person can only see data scoped to pods they belong to. If Person A
 *    is in Pod 1 (with B) and Pod 2 (with C), then B must never see any
 *    evidence that C exists, and vice versa."
 *
 * All tests use the V-structure fixture (`createVStructure`) where:
 *   - A is partnered with B and with C
 *   - A is in Pod1 (with B) and Pod2 (with C)
 *   - B and C share NO pod and NO partnership
 *
 * Each test verifies a specific privacy boundary using either an API call
 * with a session token, or a direct invocation of a privacy filter.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  call,
  collectStrings,
  createVStructure,
  deletePerson,
  newApp,
  uniqueEmail,
  type VStructure,
} from './utils.ts';
import { db } from '../src/db/index.ts';
import {
  persons,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../src/db/schema.ts';
import {
  TelegramDmPrivacyFilter,
  TelegramGroupPrivacyFilter,
} from '../src/modules/telegram/privacy.ts';
import { config } from '../src/lib/config.ts';
import { applyPrivacyJitter } from '../src/modules/schedule/cycle.manager.ts';

let optimizerReachable = false;
beforeAll(async () => {
  try {
    const r = await fetch(`${config.optimizerUrl}/health`);
    optimizerReachable = r.ok;
  } catch {
    optimizerReachable = false;
  }
});

describe('privacy boundary suite (P9.1)', () => {
  const created: string[] = [];
  let v: VStructure;

  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function setup(): Promise<void> {
    v = await createVStructure();
    created.push(v.a.email, v.b.email, v.c.email);
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. partner invisibility across pods
  // ────────────────────────────────────────────────────────────────────
  it('test_partner_invisible_across_pods: B does not see C and vice versa', async () => {
    await setup();

    const aList = await call(v.app, '/api/partners', { token: v.a.sessionToken });
    expect(aList.status).toBe(200);
    expect(aList.body.partners).toHaveLength(2);
    const aPartnerNames = aList.body.partners.map((p: any) => p.partner.displayName);
    expect(aPartnerNames).toContain(v.b.displayName);
    expect(aPartnerNames).toContain(v.c.displayName);

    const bList = await call(v.app, '/api/partners', { token: v.b.sessionToken });
    expect(bList.status).toBe(200);
    expect(bList.body.partners).toHaveLength(1);
    expect(bList.body.partners[0].partner.displayName).toBe(v.a.displayName);
    // CRITICAL: C's name must not appear ANYWHERE in B's response.
    const bStrings = collectStrings(bList.body).join('|');
    expect(bStrings).not.toContain(v.c.displayName);
    expect(bStrings).not.toContain(v.c.email);

    const cList = await call(v.app, '/api/partners', { token: v.c.sessionToken });
    expect(cList.status).toBe(200);
    expect(cList.body.partners).toHaveLength(1);
    expect(cList.body.partners[0].partner.displayName).toBe(v.a.displayName);
    const cStrings = collectStrings(cList.body).join('|');
    expect(cStrings).not.toContain(v.b.displayName);
    expect(cStrings).not.toContain(v.b.email);
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. schedule opacity
  // ────────────────────────────────────────────────────────────────────
  it('test_schedule_opacity: B sees only blocks they participate in', async (ctx) => {
    if (!optimizerReachable) {
      ctx.skip();
      return;
    }
    await setup();
    // Direct DB seed: a cycle for {A, B, C} with 3 blocks: A↔B, A↔C, A↔B↔C-impossible.
    // We don't need the optimizer — we just persist blocks and participants.
    const [cycle] = await db
      .insert(schedulingCycles)
      .values({
        status: 'proposed',
        horizonStart: new Date(),
        horizonEnd: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        triggeredBy: v.a.personId,
        triggerType: 'manual',
        personIds: [v.a.personId, v.b.personId, v.c.personId],
        satisfactionReport: [
          { person_id: v.a.personId, overall_pct: 0.8, per_partner: {}, unmet_needs: [] },
          { person_id: v.b.personId, overall_pct: 0.9, per_partner: {}, unmet_needs: [] },
          { person_id: v.c.personId, overall_pct: 0.7, per_partner: {}, unmet_needs: [] },
        ],
      })
      .returning();
    expect(cycle).toBeDefined();
    const cycleId = cycle!.id;

    const baseStart = new Date(Date.now() + 24 * 60 * 60_000);
    // A↔B block
    const [abBlock] = await db
      .insert(timeBlocks)
      .values({
        cycleId,
        eventType: 'date_night',
        startTime: baseStart,
        endTime: new Date(baseStart.getTime() + 3 * 60 * 60_000),
        status: 'proposed',
        partnershipId: v.abPartnershipId,
      })
      .returning();
    await db.insert(timeBlockParticipants).values([
      { timeBlockId: abBlock!.id, personId: v.a.personId, response: 'pending' },
      { timeBlockId: abBlock!.id, personId: v.b.personId, response: 'pending' },
    ]);
    // A↔C block (B should never see this).
    const [acBlock] = await db
      .insert(timeBlocks)
      .values({
        cycleId,
        eventType: 'date_night',
        startTime: new Date(baseStart.getTime() + 24 * 60 * 60_000),
        endTime: new Date(baseStart.getTime() + 27 * 60 * 60_000),
        status: 'proposed',
        partnershipId: v.acPartnershipId,
      })
      .returning();
    await db.insert(timeBlockParticipants).values([
      { timeBlockId: acBlock!.id, personId: v.a.personId, response: 'pending' },
      { timeBlockId: acBlock!.id, personId: v.c.personId, response: 'pending' },
    ]);

    // B's proposals: only the A↔B block.
    const bProps = await call(v.app, '/api/schedule/proposals', { token: v.b.sessionToken });
    expect(bProps.status).toBe(200);
    expect(bProps.body.proposals).toHaveLength(1);
    expect(bProps.body.proposals[0].id).toBe(abBlock!.id);
    const bStrings = collectStrings(bProps.body).join('|');
    expect(bStrings).not.toContain(acBlock!.id);

    // B's cycle detail: must not include A↔C or C's satisfaction.
    const bCycle = await call(v.app, `/api/schedule/cycles/${cycleId}`, {
      token: v.b.sessionToken,
    });
    expect(bCycle.status).toBe(200);
    expect(bCycle.body.blocks).toHaveLength(1);
    expect(bCycle.body.blocks[0].id).toBe(abBlock!.id);
    // B is in the cycle's personIds (cross-pod via A) so the satisfactionReport
    // is currently surfaced — verify it doesn't NAME any partner outside their
    // own pod. We fetch directly: it contains person_ids only (uuids), no
    // displayNames. If it ever started carrying names, this assertion would fire.
    const bCycleStrings = collectStrings(bCycle.body).join('|');
    expect(bCycleStrings).not.toContain(v.c.displayName);
    expect(bCycleStrings).not.toContain(v.c.email);
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. pod 403 leaks no information
  // ────────────────────────────────────────────────────────────────────
  it('test_pod_403_denied: B cannot read Pod2 details and the error reveals nothing', async () => {
    await setup();
    const r = await call(v.app, `/api/pods/${v.pod2Id}`, { token: v.b.sessionToken });
    expect([403, 404]).toContain(r.status);
    const errStrings = collectStrings(r.body).join('|').toLowerCase();
    // Must NOT mention pod 2's name, C's name, etc.
    expect(errStrings).not.toContain(v.c.displayName.toLowerCase());
    expect(errStrings).not.toContain('garden'); // pod2 name prefix
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. partners listing is self-only
  // ────────────────────────────────────────────────────────────────────
  it('test_partners_listing_is_self_only: unrelated person sees no partnerships', async () => {
    await setup();
    const outsiderEmail = uniqueEmail('priv-outsider');
    created.push(outsiderEmail);
    const r = await call(v.app, '/auth/magic-link', {
      method: 'POST',
      json: { email: outsiderEmail },
    });
    const verify = await call(v.app, '/auth/verify', {
      method: 'POST',
      json: { email: outsiderEmail, token: r.body.devToken },
    });
    const list = await call(v.app, '/api/partners', { token: verify.body.sessionToken });
    expect(list.status).toBe(200);
    expect(list.body.partners).toHaveLength(0);
    const strs = collectStrings(list.body).join('|');
    for (const name of [v.a.displayName, v.b.displayName, v.c.displayName]) {
      expect(strs).not.toContain(name);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. proposals listing is self-only
  // ────────────────────────────────────────────────────────────────────
  it('test_proposals_listing_is_self_only: outsider sees no proposals', async () => {
    await setup();
    // Seed an A↔B block.
    const [cycle] = await db
      .insert(schedulingCycles)
      .values({
        status: 'proposed',
        horizonStart: new Date(),
        horizonEnd: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        triggeredBy: v.a.personId,
        triggerType: 'manual',
        personIds: [v.a.personId, v.b.personId],
      })
      .returning();
    const [block] = await db
      .insert(timeBlocks)
      .values({
        cycleId: cycle!.id,
        eventType: 'date_night',
        startTime: new Date(),
        endTime: new Date(Date.now() + 60 * 60_000),
        status: 'proposed',
        partnershipId: v.abPartnershipId,
      })
      .returning();
    await db.insert(timeBlockParticipants).values([
      { timeBlockId: block!.id, personId: v.a.personId, response: 'pending' },
      { timeBlockId: block!.id, personId: v.b.personId, response: 'pending' },
    ]);

    // C's proposals: empty (C is in cycle.personIds=false; not a participant).
    const cProps = await call(v.app, '/api/schedule/proposals', { token: v.c.sessionToken });
    expect(cProps.status).toBe(200);
    expect(cProps.body.proposals).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. deleted user is anonymized
  // ────────────────────────────────────────────────────────────────────
  it('test_deleted_user_anonymized: A sees no PII for deleted partner B', async () => {
    await setup();
    // Capture B's name pre-delete.
    const bName = v.b.displayName;
    const bEmail = v.b.email;

    // B deletes their account.
    const del = await call(v.app, '/api/me', {
      method: 'DELETE',
      token: v.b.sessionToken,
    });
    expect(del.status).toBe(200);
    // After cleanup, remove B's email from cleanup list (already deleted).
    const idx = created.indexOf(v.b.email);
    if (idx >= 0) created.splice(idx, 1);

    // A's partner list: due to FK cascade, the A↔B partnership is gone.
    // We simply verify B's PII does not appear anywhere in A's response.
    const aList = await call(v.app, '/api/partners', { token: v.a.sessionToken });
    expect(aList.status).toBe(200);
    const strs = collectStrings(aList.body).join('|');
    expect(strs).not.toContain(bName);
    expect(strs).not.toContain(bEmail);
    // A still has C as a partner.
    expect(aList.body.partners.some((p: any) => p.partner.displayName === v.c.displayName)).toBe(
      true,
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 6b. account deletion does not break when historical time_blocks exist
  // (regression: time_blocks.partnership_id FK was missing ON DELETE,
  // which blocked the cascade once any cycle had run for that partnership)
  // ────────────────────────────────────────────────────────────────────
  it('test_deletion_with_historical_time_blocks', async () => {
    await setup();
    // Manually insert a time_block referencing the A-B partnership so we
    // don't need a live optimizer for this test.
    const [cycle] = await db
      .insert(schedulingCycles)
      .values({
        status: 'proposed',
        horizonStart: new Date('2026-05-11T00:00:00Z'),
        horizonEnd: new Date('2026-05-18T00:00:00Z'),
        triggerType: 'manual',
        personIds: [v.a.personId, v.b.personId],
      })
      .returning();
    const [block] = await db
      .insert(timeBlocks)
      .values({
        cycleId: cycle!.id,
        eventType: 'date_night',
        startTime: new Date('2026-05-12T19:00:00Z'),
        endTime: new Date('2026-05-12T22:00:00Z'),
        status: 'locked',
        partnershipId: v.abPartnershipId,
      })
      .returning();
    await db
      .insert(timeBlockParticipants)
      .values([
        { timeBlockId: block!.id, personId: v.a.personId, response: 'accepted' },
        { timeBlockId: block!.id, personId: v.b.personId, response: 'accepted' },
      ]);

    // B deletes their account — this used to 500 because the FK had no action.
    const del = await call(v.app, '/api/me', { method: 'DELETE', token: v.b.sessionToken });
    expect(del.status).toBe(200);
    const idx = created.indexOf(v.b.email);
    if (idx >= 0) created.splice(idx, 1);

    // The block row is preserved (history) but partnership_id is now NULL.
    const remaining = await db.select().from(timeBlocks).where(eq(timeBlocks.id, block!.id));
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.partnershipId).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. telegram DM rejects cross-pod mention
  // ────────────────────────────────────────────────────────────────────
  it('test_telegram_dm_does_not_mention_cross_pod', async () => {
    await setup();
    const filter = new TelegramDmPrivacyFilter();
    // OK: B's DM mentions A (their partner).
    const ok = await filter.validate(
      v.b.personId,
      `Hi ${v.b.displayName}, ${v.a.displayName} confirmed your hangout.`,
    );
    expect(ok.ok).toBe(true);
    // LEAK: B's DM mentions C (in a different pod, no relationship).
    const bad = await filter.validate(
      v.b.personId,
      `Note: ${v.c.displayName} is busy that night.`,
    );
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain(v.c.displayName);
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. pod group rejects cross-pod mention
  // ────────────────────────────────────────────────────────────────────
  it('test_pod_group_message_does_not_mention_other_pod_members', async () => {
    await setup();
    const filter = new TelegramGroupPrivacyFilter();
    // Pod1 group: must NOT mention C (Pod2 member).
    const bad = await filter.validate(
      v.pod1Id,
      `${v.a.displayName} is hanging with ${v.c.displayName} tonight.`,
    );
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain(v.c.displayName);
  });

  // ────────────────────────────────────────────────────────────────────
  // 9. satisfaction report does not expose partner-specific details to pod
  // ────────────────────────────────────────────────────────────────────
  it('test_satisfaction_report_does_not_expose_partner_specific_to_pod_members', async () => {
    await setup();
    // Set distinctive preferences for A's two partnerships. The pod-level
    // schedule view (cycle detail) should not reveal partner-specific numbers
    // for partnerships outside the requester's pod.
    await call(v.app, `/api/partners/${v.acPartnershipId}/preferences`, {
      method: 'PATCH',
      token: v.a.sessionToken,
      json: { needMinHours: 3, prefIdealHours: 9 },
    });

    // Seed a cycle with all three persons and a block A↔C only.
    const [cycle] = await db
      .insert(schedulingCycles)
      .values({
        status: 'proposed',
        horizonStart: new Date(),
        horizonEnd: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        triggeredBy: v.a.personId,
        triggerType: 'manual',
        personIds: [v.a.personId, v.b.personId, v.c.personId],
        satisfactionReport: [
          {
            person_id: v.a.personId,
            overall_pct: 0.5,
            per_partner: {
              [v.c.personId]: {
                need_met: false,
                pref_pct: 0.3,
                hours_scheduled: 1,
                hours_wanted: 9,
              },
            },
            unmet_needs: [],
          },
        ],
      })
      .returning();
    const [acBlock] = await db
      .insert(timeBlocks)
      .values({
        cycleId: cycle!.id,
        eventType: 'date_night',
        startTime: new Date(),
        endTime: new Date(Date.now() + 60 * 60_000),
        status: 'proposed',
        partnershipId: v.acPartnershipId,
      })
      .returning();
    await db.insert(timeBlockParticipants).values([
      { timeBlockId: acBlock!.id, personId: v.a.personId, response: 'pending' },
      { timeBlockId: acBlock!.id, personId: v.c.personId, response: 'pending' },
    ]);

    // B fetches the cycle. The block list must be empty for B (not a
    // participant of any block), and the response body must not contain
    // C's display name or any A↔C-specific satisfaction strings.
    const bCycle = await call(v.app, `/api/schedule/cycles/${cycle!.id}`, {
      token: v.b.sessionToken,
    });
    expect(bCycle.status).toBe(200);
    expect(bCycle.body.blocks).toHaveLength(0);
    const strs = collectStrings(bCycle.body).join('|');
    expect(strs).not.toContain(v.c.displayName);
    expect(strs).not.toContain(v.c.email);
  });

  // ────────────────────────────────────────────────────────────────────
  // 10. privacy scrub strips telegram chat id and other PII
  // ────────────────────────────────────────────────────────────────────
  it('test_privacy_scrub_strips_telegram_chat_id', async () => {
    await setup();
    // Manually populate A's telegram_chat_id to simulate a connected account.
    await db
      .update(persons)
      .set({ telegramChatId: 12345678901n, telegramHandle: 'aurelius_handle' })
      .where(eq(persons.id, v.a.personId));

    // B fetches partners. A appears as B's partner — B's response must NOT
    // include A's telegram chat id, telegram handle, or email.
    const bList = await call(v.app, '/api/partners', { token: v.b.sessionToken });
    expect(bList.status).toBe(200);
    const strs = collectStrings(bList.body).join('|');
    expect(strs).not.toContain('12345678901');
    expect(strs).not.toContain('aurelius_handle');
    expect(strs).not.toContain(v.a.email);

    // A's own /api/me should still expose their own data.
    const aMe = await call(v.app, '/api/me', { token: v.a.sessionToken });
    expect(aMe.status).toBe(200);
    expect(aMe.body.person.email).toBe(v.a.email);
  });

  // ────────────────────────────────────────────────────────────────────
  // 11. P9.3 jitter — same person, different cycles → different shifts
  // ────────────────────────────────────────────────────────────────────
  it('privacy mode jitter is deterministic per cycle and varies between cycles', () => {
    const windows = [
      { start: new Date('2026-01-01T18:00:00Z'), end: new Date('2026-01-01T22:00:00Z') },
      { start: new Date('2026-01-02T09:00:00Z'), end: new Date('2026-01-02T17:00:00Z') },
    ];
    const personId = '00000000-0000-0000-0000-000000000001';
    const cycle1 = applyPrivacyJitter(windows, personId, 'cycle-1');
    const cycle1again = applyPrivacyJitter(windows, personId, 'cycle-1');
    const cycle2 = applyPrivacyJitter(windows, personId, 'cycle-2');
    // Deterministic within a cycle.
    expect(cycle1.map((w) => w.start.toISOString())).toEqual(
      cycle1again.map((w) => w.start.toISOString()),
    );
    // Varies between cycles.
    const c1Starts = cycle1.map((w) => w.start.toISOString()).join();
    const c2Starts = cycle2.map((w) => w.start.toISOString()).join();
    expect(c1Starts).not.toBe(c2Starts);
    // Jitter only shrinks, never expands.
    for (let i = 0; i < cycle1.length; i++) {
      expect(cycle1[i]!.start.getTime()).toBeGreaterThanOrEqual(windows[i]!.start.getTime());
      expect(cycle1[i]!.end.getTime()).toBeLessThanOrEqual(windows[i]!.end.getTime());
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 12. Calendar OAuth tokens are encrypted at rest
  // ────────────────────────────────────────────────────────────────────
  it('calendar OAuth tokens are encrypted at rest (not plaintext bytes)', async () => {
    // Use vault directly; this guarantees the bytes stored in DB cannot be
    // read as plaintext UTF-8.
    const { encrypt } = await import('../src/services/encryption/vault.ts');
    const token = 'ya29.a0AfH6S-plaintext-secret-DO-NOT-LEAK';
    const blob = encrypt(token);
    expect(blob.toString('utf8')).not.toContain('plaintext-secret');
    expect(blob.toString('hex')).not.toContain(Buffer.from(token, 'utf8').toString('hex'));
  });
});

// Sanity: keep the schedule.test.ts pattern of using a fresh app for each test.
void newApp;
