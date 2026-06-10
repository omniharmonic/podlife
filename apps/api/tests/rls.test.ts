/**
 * RLS enforcement suite — proves the database-layer privacy backstop (CLAUDE.md
 * § Privacy Model, "Layer 2") is real, not inert.
 *
 * Unlike privacy.test.ts (which exercises routes), these tests query the `db`
 * directly inside a person context via runWithPersonContext and assert that
 * Postgres itself hides rows the person isn't entitled to — even though the
 * application code issues an unscoped `SELECT * FROM partnerships`. This is the
 * backstop that contains any application-level scope bug.
 *
 * NOTE: this only enforces when the app connects as a NON-superuser role
 * without BYPASSRLS (superusers bypass RLS unconditionally). See
 * post-migrate.sql (podlife_app role) and SELF_HOSTING.md.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { partnerships, podMembers } from '../src/db/schema.ts';
import { db } from '../src/db/index.ts';
import { runWithPersonContext, runWithServiceContext } from '../src/db/rls.ts';
import { createVStructure, deletePerson, type VStructure } from './utils.ts';

describe('RLS enforcement (DB-layer privacy backstop)', () => {
  const created: string[] = [];
  let v: VStructure;

  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function setup(): Promise<void> {
    v = await createVStructure();
    created.push(v.a.email, v.b.email, v.c.email);
  }

  it('an unscoped partnerships SELECT only returns the requester’s rows', async () => {
    await setup();

    // A is partnered with B and C → sees 2.
    const aRows = await runWithPersonContext(v.a.personId, () =>
      db.select().from(partnerships),
    );
    expect(aRows).toHaveLength(2);
    for (const row of aRows) {
      expect([row.personAId, row.personBId]).toContain(v.a.personId);
    }

    // B is partnered only with A → sees 1, and C's partnership is invisible.
    const bRows = await runWithPersonContext(v.b.personId, () =>
      db.select().from(partnerships),
    );
    expect(bRows).toHaveLength(1);
    const bVisibleIds = new Set(bRows.flatMap((r) => [r.personAId, r.personBId]));
    expect(bVisibleIds.has(v.c.personId)).toBe(false);
  });

  it('a stranger sees zero partnerships even with a raw SELECT', async () => {
    await setup();
    const strangerId = '00000000-0000-0000-0000-000000000000';
    const rows = await runWithPersonContext(strangerId, () =>
      db.select().from(partnerships),
    );
    expect(rows).toHaveLength(0);
  });

  it('pod_members is scoped: B (Pod1) cannot see Pod2’s membership rows', async () => {
    await setup();
    const bPodMembers = await runWithPersonContext(v.b.personId, () =>
      db.select().from(podMembers),
    );
    // B only belongs to Pod1; every visible row must be a pod B is in.
    const bPodIds = new Set(bPodMembers.map((m) => m.podId));
    // C is only in Pod2 → C must not appear anywhere B can see.
    const leaksC = bPodMembers.some((m) => m.personId === v.c.personId);
    expect(leaksC).toBe(false);
    expect(bPodIds.size).toBeGreaterThanOrEqual(1);
  });

  it('service context bypasses RLS for trusted server code', async () => {
    await setup();
    const all = await runWithServiceContext(() => db.select().from(partnerships));
    // Sees both A↔B and A↔C (at minimum) — the cross-person view jobs rely on.
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
