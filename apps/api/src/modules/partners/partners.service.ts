/**
 * Partner service: invites + partnership creation + preferences.
 * Per arch § 8.2.
 *
 * Privacy invariant (CLAUDE.md § Privacy Model):
 *   A person only sees partnerships involving themselves.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  PARTNER_COLORS,
  PARTNER_INVITE_TTL_DAYS,
  type PartnerSummary,
  type PartnershipPreference as PartnershipPreferenceDto,
  type RelationshipType,
  type SchedulingCadence,
} from '@pod-life/shared';
import { db } from '../../db/index.js';
import {
  auditLog,
  invites,
  partnershipPreferences,
  partnerships,
  persons,
  podMembers,
  pods,
} from '../../db/schema.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { send as notify } from '../../services/notification/notification.service.js';
import { logger } from '../../lib/logger.js';

/** UUIDs as strings sort lexically and respect the CHECK person_a_id < person_b_id. */
export function canonicalPair(a: string, b: string): { aId: string; bId: string } {
  return a < b ? { aId: a, bId: b } : { aId: b, bId: a };
}

/**
 * Mint a partner invite. Caller is the inviter; anyone with the resulting
 * token can later accept (the token is the bearer credential). Invite rows
 * live in the unified `invites` table and are revocable by the inviter.
 */
export async function createPartnerInvite(
  inviterId: string,
  displayHint?: string,
  relationshipType: RelationshipType = 'partnership',
): Promise<{ token: string; expiresAt: Date }> {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + PARTNER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(invites).values({
    kind: 'partner',
    invitedBy: inviterId,
    token,
    inviteeDisplayHint: displayHint ?? null,
    relationshipType,
    expiresAt,
  });
  return { token, expiresAt };
}

export type InviteRow = typeof invites.$inferSelect;

/**
 * Apply a pre-validated partner invite: create the partnership, default
 * preferences, audit log on both sides, and notify the inviter. The caller
 * (invites.service) is responsible for token lookup, expiry/revocation
 * checks, self-accept rejection, and finally marking the invite accepted.
 *
 * Split from the old `acceptInvite` so the unified invites module can
 * orchestrate without duplicating partnership-creation logic here.
 */
export async function materializePartnershipFromInvite(
  invite: InviteRow,
  acceptingPersonId: string,
): Promise<{ partnershipId: string }> {
  if (invite.kind !== 'partner') {
    throw new ValidationError('Invite is not a partner invite');
  }
  if (!invite.relationshipType) {
    throw new ValidationError('Partner invite missing relationship type');
  }
  if (invite.invitedBy === acceptingPersonId) {
    throw new ValidationError('Cannot accept your own invite');
  }

  const { aId, bId } = canonicalPair(invite.invitedBy, acceptingPersonId);

  // Check for existing partnership.
  const existing = await db
    .select()
    .from(partnerships)
    .where(and(eq(partnerships.personAId, aId), eq(partnerships.personBId, bId)))
    .limit(1);
  if (existing.length > 0) {
    throw new ConflictError('Partnership already exists');
  }

  // Pick deterministic colors based on order.
  const colorA = PARTNER_COLORS[0] ?? '#E07A5F';
  const colorB = PARTNER_COLORS[1] ?? '#81B29A';

  const [partnership] = await db
    .insert(partnerships)
    .values({
      personAId: aId,
      personBId: bId,
      status: 'active',
      relationshipType: invite.relationshipType,
      invitedBy: invite.invitedBy,
      colorA,
      colorB,
    })
    .returning();
  if (!partnership) throw new Error('Failed to create partnership');

  // Default preferences for both sides.
  await db.insert(partnershipPreferences).values([
    { partnershipId: partnership.id, personId: aId },
    { partnershipId: partnership.id, personId: bId },
  ]);

  await db
    .update(invites)
    .set({ acceptedAt: new Date(), acceptedBy: acceptingPersonId })
    .where(eq(invites.id, invite.id));

  // Audit both sides of the new partnership (P9.4).
  await db.insert(auditLog).values([
    {
      personId: invite.invitedBy,
      action: 'partnership.create',
      resourceType: 'partnership',
      resourceId: partnership.id,
      metadata: {},
    },
    {
      personId: acceptingPersonId,
      action: 'partnership.create',
      resourceType: 'partnership',
      resourceId: partnership.id,
      metadata: {},
    },
  ]);

  // Notify the inviter that their invite was accepted. Best-effort —
  // failures here must not fail the partnership creation.
  try {
    const accepter = await db
      .select({ displayName: persons.displayName })
      .from(persons)
      .where(eq(persons.id, acceptingPersonId))
      .limit(1);
    const accepterName = accepter[0]?.displayName ?? 'Someone';
    await notify(invite.invitedBy, {
      title: 'Partner invite accepted',
      body: `${accepterName} accepted your invitation.`,
      actionUrl: '/partners',
      channels: ['in_app'],
    });
  } catch (err) {
    logger.warn('partner-accept notification failed', {
      partnershipId: partnership.id,
      err: (err as Error).message,
    });
  }

  return { partnershipId: partnership.id };
}

/**
 * Find every pod that contains both `personA` and `personB` as members.
 * Used to detect when a partnership lives inside a shared pod — that pod's
 * cadence becomes authoritative and the per-partnership cadence is hidden
 * in the UI and rejected at the API.
 *
 * The two-side IN-list is cheap: pod_members has a btree index on person_id
 * and the inner join + group-by-podId-with-count-2 fits the small fanout
 * we expect (a person belongs to a handful of pods, not thousands).
 */
async function findSharedPods(
  personA: string,
  personB: string,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .select({ id: pods.id, name: pods.name })
    .from(pods)
    .innerJoin(podMembers, eq(podMembers.podId, pods.id))
    .where(inArray(podMembers.personId, [personA, personB]))
    .groupBy(pods.id, pods.name)
    .having(sql`count(distinct ${podMembers.personId}) = 2`);
  return rows;
}

export async function listPartners(personId: string): Promise<PartnerSummary[]> {
  const rows = await db
    .select({
      partnership: partnerships,
      partner: persons,
    })
    .from(partnerships)
    .innerJoin(
      persons,
      or(
        and(eq(partnerships.personAId, personId), eq(persons.id, partnerships.personBId)),
        and(eq(partnerships.personBId, personId), eq(persons.id, partnerships.personAId)),
      ),
    )
    .where(or(eq(partnerships.personAId, personId), eq(partnerships.personBId, personId)));

  const prefs = rows.length
    ? await db
        .select()
        .from(partnershipPreferences)
        .where(eq(partnershipPreferences.personId, personId))
    : [];
  const prefByPartnership = new Map(prefs.map((p) => [p.partnershipId, p]));

  // Compute shared pods per partnership in parallel. This is N partnership-
  // count round trips, which is fine for the typical "handful of partners"
  // scale — if it ever becomes hot, batch into a single SQL with a join
  // back to partnerships on (personAId, personBId).
  const sharedPodsByPartnership = new Map<string, Array<{ id: string; name: string }>>();
  await Promise.all(
    rows.map(async (r) => {
      const otherId = r.partner.id;
      const shared = await findSharedPods(personId, otherId);
      sharedPodsByPartnership.set(r.partnership.id, shared);
    }),
  );

  return rows.map((r) => {
    const myPrefRow = prefByPartnership.get(r.partnership.id);
    const myPrefs: PartnershipPreferenceDto | null = myPrefRow
      ? rowToPrefDto(myPrefRow)
      : null;
    const isPersonA = r.partnership.personAId === personId;
    return {
      partnershipId: r.partnership.id,
      partner: {
        id: r.partner.id,
        displayName: r.partner.displayName,
        avatarUrl: r.partner.avatarUrl,
      },
      myPreferences: myPrefs,
      color: (isPersonA ? r.partnership.colorA : r.partnership.colorB) ?? '#E07A5F',
      status: r.partnership.status,
      relationshipType: (r.partnership.relationshipType as RelationshipType) ?? 'partnership',
      cadence: (r.partnership.cadence as SchedulingCadence) ?? 'weekly',
      pendingCadence: (r.partnership.pendingCadence as SchedulingCadence | null) ?? null,
      pendingCadenceBy: r.partnership.pendingCadenceBy ?? null,
      sharedPods: sharedPodsByPartnership.get(r.partnership.id) ?? [],
    };
  });
}

/**
 * Throw a 400 if the two partners share at least one pod. Pod cadence is
 * authoritative for pod-internal scheduling, so per-partnership cadence
 * proposals don't make sense in that case — the UI hides the picker, and
 * this server-side guard catches any direct API access.
 */
async function assertNoSharedPod(partnership: typeof partnerships.$inferSelect): Promise<void> {
  const shared = await findSharedPods(partnership.personAId, partnership.personBId);
  if (shared.length > 0) {
    throw new ValidationError(
      `Cadence is set by your shared pod${shared.length === 1 ? '' : 's'} (${shared
        .map((p) => p.name)
        .join(', ')}). Edit the pod's check-in rhythm instead.`,
    );
  }
}

/**
 * Propose a new cadence for a partnership. Either party can propose. The
 * proposal stays in `pending_cadence` until the *other* party accepts.
 *
 * Edge cases handled here:
 *  - Proposing the current cadence clears any pending proposal (treated as
 *    a withdrawal / no-op rather than rejected).
 *  - Re-proposing while a proposal is already pending overwrites it,
 *    regardless of who proposed it last — last writer wins.
 */
export async function proposeCadence(
  personId: string,
  partnershipId: string,
  cadence: SchedulingCadence,
): Promise<{ cadence: SchedulingCadence; pendingCadence: SchedulingCadence | null; pendingCadenceBy: string | null }> {
  await assertPartnershipMember(personId, partnershipId);
  const rows = await db
    .select()
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId))
    .limit(1);
  const p = rows[0];
  if (!p) throw new NotFoundError('Partnership not found');
  await assertNoSharedPod(p);

  const current = (p.cadence as SchedulingCadence) ?? 'weekly';

  // Proposing the current cadence withdraws any pending proposal.
  if (cadence === current) {
    const [updated] = await db
      .update(partnerships)
      .set({ pendingCadence: null, pendingCadenceBy: null })
      .where(eq(partnerships.id, partnershipId))
      .returning();
    if (!updated) throw new NotFoundError('Partnership not found');
    await db.insert(auditLog).values({
      personId,
      action: 'partnership.cadence.withdraw',
      resourceType: 'partnership',
      resourceId: partnershipId,
      metadata: { cadence },
    });
    return { cadence: current, pendingCadence: null, pendingCadenceBy: null };
  }

  const [updated] = await db
    .update(partnerships)
    .set({ pendingCadence: cadence, pendingCadenceBy: personId })
    .where(eq(partnerships.id, partnershipId))
    .returning();
  if (!updated) throw new NotFoundError('Partnership not found');

  await db.insert(auditLog).values({
    personId,
    action: 'partnership.cadence.propose',
    resourceType: 'partnership',
    resourceId: partnershipId,
    metadata: { from: current, to: cadence },
  });

  return {
    cadence: current,
    pendingCadence: cadence,
    pendingCadenceBy: personId,
  };
}

/**
 * Accept the pending cadence proposal — only the *other* party can do this.
 * 400 if there's no pending proposal; 400 if the caller is the proposer.
 */
export async function acceptCadenceProposal(
  personId: string,
  partnershipId: string,
): Promise<{ cadence: SchedulingCadence; pendingCadence: null; pendingCadenceBy: null }> {
  await assertPartnershipMember(personId, partnershipId);
  const rows = await db
    .select()
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId))
    .limit(1);
  const p = rows[0];
  if (!p) throw new NotFoundError('Partnership not found');
  await assertNoSharedPod(p);
  if (!p.pendingCadence || !p.pendingCadenceBy) {
    throw new ValidationError('No cadence proposal to accept');
  }
  if (p.pendingCadenceBy === personId) {
    throw new ValidationError('You proposed this cadence — wait for the other party to accept');
  }

  const next = p.pendingCadence as SchedulingCadence;
  const [updated] = await db
    .update(partnerships)
    .set({ cadence: next, pendingCadence: null, pendingCadenceBy: null })
    .where(eq(partnerships.id, partnershipId))
    .returning();
  if (!updated) throw new NotFoundError('Partnership not found');

  await db.insert(auditLog).values({
    personId,
    action: 'partnership.cadence.accept',
    resourceType: 'partnership',
    resourceId: partnershipId,
    metadata: { cadence: next },
  });

  return { cadence: next, pendingCadence: null, pendingCadenceBy: null };
}

/**
 * Decline a pending cadence proposal. Either party can decline — the
 * proposer treats this as a withdrawal, the other party as a rejection.
 * The semantic distinction doesn't change the resulting state: pending
 * cleared, current cadence unchanged.
 */
export async function declineCadenceProposal(
  personId: string,
  partnershipId: string,
): Promise<{ cadence: SchedulingCadence; pendingCadence: null; pendingCadenceBy: null }> {
  await assertPartnershipMember(personId, partnershipId);
  const rows = await db
    .select()
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId))
    .limit(1);
  const p = rows[0];
  if (!p) throw new NotFoundError('Partnership not found');
  await assertNoSharedPod(p);
  if (!p.pendingCadence) {
    throw new ValidationError('No cadence proposal to decline');
  }

  const [updated] = await db
    .update(partnerships)
    .set({ pendingCadence: null, pendingCadenceBy: null })
    .where(eq(partnerships.id, partnershipId))
    .returning();
  if (!updated) throw new NotFoundError('Partnership not found');

  await db.insert(auditLog).values({
    personId,
    action: 'partnership.cadence.decline',
    resourceType: 'partnership',
    resourceId: partnershipId,
    metadata: { declinedProposal: p.pendingCadence },
  });

  return {
    cadence: (updated.cadence as SchedulingCadence) ?? 'weekly',
    pendingCadence: null,
    pendingCadenceBy: null,
  };
}

export async function updateRelationshipType(
  personId: string,
  partnershipId: string,
  relationshipType: RelationshipType,
): Promise<{ id: string; relationshipType: RelationshipType }> {
  await assertPartnershipMember(personId, partnershipId);
  const [updated] = await db
    .update(partnerships)
    .set({ relationshipType })
    .where(eq(partnerships.id, partnershipId))
    .returning();
  if (!updated) throw new NotFoundError('Partnership not found');

  await db.insert(auditLog).values({
    personId,
    action: 'partnership.relationship_type',
    resourceType: 'partnership',
    resourceId: partnershipId,
    metadata: { relationshipType },
  });

  return {
    id: updated.id,
    relationshipType: (updated.relationshipType as RelationshipType) ?? 'partnership',
  };
}

export function rowToPrefDto(
  row: typeof partnershipPreferences.$inferSelect,
): PartnershipPreferenceDto {
  return {
    id: row.id,
    partnershipId: row.partnershipId,
    personId: row.personId,
    cadence: row.cadence,
    needMinHours: Number(row.needMinHours),
    needMinDateNights: row.needMinDateNights,
    needMinOvernights: row.needMinOvernights,
    prefIdealHours: Number(row.prefIdealHours),
    prefDateNights: row.prefDateNights,
    prefOvernights: row.prefOvernights,
    prefDaytimeHangs: row.prefDaytimeHangs,
    customEventPrefs: (row.customEventPrefs as PartnershipPreferenceDto['customEventPrefs']) ?? [],
    recurringHolds: (row.recurringHolds as PartnershipPreferenceDto['recurringHolds']) ?? [],
    preferredWindows: (row.preferredWindows as PartnershipPreferenceDto['preferredWindows']) ?? [],
  };
}

export async function getMyPreferences(
  personId: string,
  partnershipId: string,
): Promise<PartnershipPreferenceDto> {
  await assertPartnershipMember(personId, partnershipId);
  const rows = await db
    .select()
    .from(partnershipPreferences)
    .where(
      and(
        eq(partnershipPreferences.partnershipId, partnershipId),
        eq(partnershipPreferences.personId, personId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Preferences not found');
  return rowToPrefDto(rows[0]);
}

export async function updateMyPreferences(
  personId: string,
  partnershipId: string,
  data: Partial<{
    cadence: 'weekly' | 'biweekly' | 'monthly';
    needMinHours: number;
    needMinDateNights: number;
    needMinOvernights: number;
    prefIdealHours: number;
    prefDateNights: number;
    prefOvernights: number;
    prefDaytimeHangs: number;
    customEventPrefs: unknown[];
    recurringHolds: unknown[];
    preferredWindows: unknown[];
  }>,
): Promise<PartnershipPreferenceDto> {
  await assertPartnershipMember(personId, partnershipId);
  const updates: Record<string, unknown> = {};
  if (data.cadence !== undefined) updates.cadence = data.cadence;
  if (data.needMinHours !== undefined) updates.needMinHours = String(data.needMinHours);
  if (data.needMinDateNights !== undefined) updates.needMinDateNights = data.needMinDateNights;
  if (data.needMinOvernights !== undefined) updates.needMinOvernights = data.needMinOvernights;
  if (data.prefIdealHours !== undefined) updates.prefIdealHours = String(data.prefIdealHours);
  if (data.prefDateNights !== undefined) updates.prefDateNights = data.prefDateNights;
  if (data.prefOvernights !== undefined) updates.prefOvernights = data.prefOvernights;
  if (data.prefDaytimeHangs !== undefined) updates.prefDaytimeHangs = data.prefDaytimeHangs;
  if (data.customEventPrefs !== undefined) updates.customEventPrefs = data.customEventPrefs;
  if (data.recurringHolds !== undefined) updates.recurringHolds = data.recurringHolds;
  if (data.preferredWindows !== undefined) updates.preferredWindows = data.preferredWindows;

  const [updated] = await db
    .update(partnershipPreferences)
    .set(updates)
    .where(
      and(
        eq(partnershipPreferences.partnershipId, partnershipId),
        eq(partnershipPreferences.personId, personId),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError('Preferences not found');

  await db.insert(auditLog).values({
    personId,
    action: 'partnership.preferences.update',
    resourceType: 'partnership',
    resourceId: partnershipId,
    metadata: { fields: Object.keys(updates) },
  });

  return rowToPrefDto(updated);
}

export async function updatePartnershipStatus(
  personId: string,
  partnershipId: string,
  status: 'active' | 'paused' | 'archived' | 'invited',
): Promise<{ id: string; status: string }> {
  await assertPartnershipMember(personId, partnershipId);
  const [updated] = await db
    .update(partnerships)
    .set({ status })
    .where(eq(partnerships.id, partnershipId))
    .returning();
  if (!updated) throw new NotFoundError('Partnership not found');

  await db.insert(auditLog).values({
    personId,
    action: status === 'archived' ? 'partnership.dissolve' : 'partnership.status',
    resourceType: 'partnership',
    resourceId: partnershipId,
    metadata: { status },
  });

  return { id: updated.id, status: updated.status };
}

async function assertPartnershipMember(personId: string, partnershipId: string): Promise<void> {
  const rows = await db
    .select({ id: partnerships.id })
    .from(partnerships)
    .where(
      and(
        eq(partnerships.id, partnershipId),
        or(eq(partnerships.personAId, personId), eq(partnerships.personBId, personId)),
      ),
    )
    .limit(1);
  if (!rows.length) throw new ForbiddenError('Not a member of this partnership');
}
