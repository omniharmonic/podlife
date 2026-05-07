/**
 * Partner service: invites + partnership creation + preferences.
 * Per arch § 8.2.
 *
 * Privacy invariant (CLAUDE.md § Privacy Model):
 *   A person only sees partnerships involving themselves.
 */
import { and, eq, gt, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  PARTNER_COLORS,
  PARTNER_INVITE_TTL_DAYS,
  type PartnerSummary,
  type PartnershipPreference as PartnershipPreferenceDto,
} from '@pod-life/shared';
import { db } from '../../db/index.ts';
import {
  auditLog,
  partnerInvites,
  partnershipPreferences,
  partnerships,
  persons,
} from '../../db/schema.ts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.ts';
import { config } from '../../lib/config.ts';
import { send as notify } from '../../services/notification/notification.service.ts';
import { logger } from '../../lib/logger.ts';

/** UUIDs as strings sort lexically and respect the CHECK person_a_id < person_b_id. */
export function canonicalPair(a: string, b: string): { aId: string; bId: string } {
  return a < b ? { aId: a, bId: b } : { aId: b, bId: a };
}

export async function createInvite(
  inviterId: string,
  displayHint?: string,
): Promise<{ inviteUrl: string; token: string; expiresAt: Date }> {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + PARTNER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(partnerInvites).values({
    invitedBy: inviterId,
    token,
    displayHint: displayHint ?? null,
    expiresAt,
  });
  // Must match the React Router route in apps/web/src/App.tsx (/invite/:token).
  const inviteUrl = `${config.frontendUrl}/invite/${token}`;
  return { inviteUrl, token, expiresAt };
}

export async function acceptInvite(
  acceptingPersonId: string,
  token: string,
): Promise<{ partnershipId: string }> {
  const found = await db
    .select()
    .from(partnerInvites)
    .where(and(eq(partnerInvites.token, token), gt(partnerInvites.expiresAt, new Date())))
    .limit(1);
  const invite = found[0];
  if (!invite) throw new NotFoundError('Invite not found or expired');
  if (invite.acceptedAt) throw new ConflictError('Invite already accepted');
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
    .update(partnerInvites)
    .set({ acceptedAt: new Date(), acceptedBy: acceptingPersonId })
    .where(eq(partnerInvites.id, invite.id));

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
      actionUrl: `${config.frontendUrl}/partners`,
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
    };
  });
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
