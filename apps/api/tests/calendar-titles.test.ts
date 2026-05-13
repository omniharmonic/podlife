/**
 * Coverage for the rich-calendar-title helper (T1).
 *
 * `buildTitleSuffix` is what makes events on a user's own connected
 * calendar read "Date Night with Sam" or "Pod Gathering with Home Base"
 * rather than the bare event type. The helper is per-viewer: the suffix
 * uses the *other* participant's name when the block is a partnership, so
 * the same partnership block produces different titles on each person's
 * calendar.
 *
 * These tests cover the helper directly rather than going through the
 * Google API — we don't want test outcomes to depend on a live OAuth
 * connection.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type TimeBlockRow } from '../src/db/schema.ts';
import { buildTitleSuffix } from '../src/services/calendar/calendar.writer.ts';
import { call, deletePerson, newApp, uniqueEmail } from './utils.ts';

describe('calendar titles — buildTitleSuffix', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const e of created.splice(0)) await deletePerson(e);
  });

  async function authed(
    app: ReturnType<typeof newApp>,
    prefix: string,
  ): Promise<{ token: string; id: string; displayName: string }> {
    const email = uniqueEmail(prefix);
    created.push(email);
    const r = await call(app, '/auth/magic-link', { method: 'POST', json: { email } });
    const v = await call(app, '/auth/verify', {
      method: 'POST',
      json: { email, token: r.body.devToken },
    });
    return {
      token: v.body.sessionToken,
      id: v.body.person.id,
      displayName: v.body.person.displayName,
    };
  }

  /** Minimal block row matching the column shape buildTitleSuffix reads. */
  function blockFromParts(parts: {
    partnershipId?: string | null;
    sourcePodId?: string | null;
  }): TimeBlockRow {
    return {
      id: '00000000-0000-0000-0000-000000000000',
      cycleId: '00000000-0000-0000-0000-000000000000',
      eventType: 'Date Night',
      eventLabel: null,
      startTime: new Date(),
      endTime: new Date(),
      status: 'proposed',
      sourcePodId: parts.sourcePodId ?? null,
      partnershipId: parts.partnershipId ?? null,
      satisfactionContribution: null,
      calendarEventIds: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TimeBlockRow;
  }

  it('partnership block → suffix names the *other* participant from each side', async () => {
    const app = newApp();
    const a = await authed(app, 'titA');
    const b = await authed(app, 'titB');

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: a.token,
      json: { kind: 'partner' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: b.token,
    });
    const partnershipId = acc.body.partnershipId;

    const block = blockFromParts({ partnershipId });

    const fromA = await buildTitleSuffix(block, a.id);
    const fromB = await buildTitleSuffix(block, b.id);

    // A sees B's name; B sees A's name. Different suffixes from the same block.
    expect(fromA).toBe(` with ${b.displayName}`);
    expect(fromB).toBe(` with ${a.displayName}`);
    expect(fromA).not.toBe(fromB);
  });

  it('pod block → suffix names the pod (same for every participant)', async () => {
    const app = newApp();
    const owner = await authed(app, 'titPod');

    const podRes = await call(app, '/api/pods', {
      method: 'POST',
      token: owner.token,
      json: { name: 'Home Base', emoji: '🏠' },
    });
    expect(podRes.status).toBe(200);
    const podId = podRes.body.pod.id;

    const block = blockFromParts({ sourcePodId: podId });
    const suffix = await buildTitleSuffix(block, owner.id);
    expect(suffix).toBe(' with Home Base');
  });

  it('block with neither partnership nor pod returns empty suffix', async () => {
    const app = newApp();
    const a = await authed(app, 'titSolo');
    const block = blockFromParts({});
    const suffix = await buildTitleSuffix(block, a.id);
    expect(suffix).toBe('');
  });

  it('partnership block also works after relationshipType is switched to friendship', async () => {
    // The title format doesn't change for friendships — friends still want to
    // see who they're hanging out with. But the suffix builder reads from the
    // partnership row regardless of type, so this is the regression guard.
    const app = newApp();
    const a = await authed(app, 'titFA');
    const b = await authed(app, 'titFB');

    const inv = await call(app, '/api/invites', {
      method: 'POST',
      token: a.token,
      json: { kind: 'partner', relationshipType: 'friendship' },
    });
    const acc = await call(app, `/api/invites/${inv.body.token}/accept`, {
      method: 'POST',
      token: b.token,
    });

    const block = blockFromParts({ partnershipId: acc.body.partnershipId });
    const suffix = await buildTitleSuffix(block, a.id);
    expect(suffix).toBe(` with ${b.displayName}`);
  });

  // Belt-and-suspenders: surface a regression where the partnership row is
  // missing (e.g. soft-deleted between scheduling and write) → return ''
  // rather than throwing.
  it('handles dangling partnershipId gracefully (returns empty suffix)', async () => {
    const app = newApp();
    const a = await authed(app, 'titGhost');

    const block = blockFromParts({
      partnershipId: '00000000-0000-0000-0000-000000000000',
    });
    const suffix = await buildTitleSuffix(block, a.id);
    expect(suffix).toBe('');
  });

});
