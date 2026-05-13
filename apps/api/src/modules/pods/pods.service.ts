/**
 * Pods service: create pods, manage members, manage prefs.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  POD_INVITE_TTL_DAYS,
  type Pod as PodDto,
  type PodMember as PodMemberDto,
  type PodPreference as PodPrefDto,
  type SubgroupConfig,
} from '@pod-life/shared';
import { db } from '../../db/index.js';
import {
  invites,
  podMembers,
  podPreferences,
  pods,
  persons,
} from '../../db/schema.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';

export interface CreatePodInput {
  name: string;
  description?: string;
  emoji?: string;
  schedulingCadence?: 'weekly' | 'biweekly' | 'monthly';
  planningHorizonWeeks?: number;
  reviewWindowHours?: number;
  cycleDayOfWeek?: number;
  cycleTimeOfDay?: string;
}

export async function createPod(creatorId: string, input: CreatePodInput): Promise<PodDto> {
  const [created] = await db
    .insert(pods)
    .values({
      name: input.name,
      description: input.description ?? null,
      emoji: input.emoji ?? '🏠',
      schedulingCadence: input.schedulingCadence ?? 'weekly',
      planningHorizonWeeks: input.planningHorizonWeeks ?? 1,
      reviewWindowHours: input.reviewWindowHours ?? 48,
      cycleDayOfWeek: input.cycleDayOfWeek ?? 0,
      cycleTimeOfDay: input.cycleTimeOfDay ?? '20:00',
      createdBy: creatorId,
    })
    .returning();
  if (!created) throw new Error('Failed to create pod');

  await db.insert(podMembers).values({
    podId: created.id,
    personId: creatorId,
    role: 'admin',
    joinedAt: new Date(),
  });

  await db.insert(podPreferences).values({ podId: created.id });

  return toPodDto(created);
}

export async function listPodsForPerson(personId: string): Promise<PodDto[]> {
  const rows = await db
    .select({ pod: pods })
    .from(podMembers)
    .innerJoin(pods, eq(pods.id, podMembers.podId))
    .where(and(eq(podMembers.personId, personId), isNotNull(podMembers.joinedAt)));
  return rows.map((r) => toPodDto(r.pod));
}

export async function getPodWithMembers(
  personId: string,
  podId: string,
): Promise<{ pod: PodDto; members: Array<PodMemberDto & { displayName: string; avatarUrl: string | null }> }> {
  // Caller has already passed pod-access middleware.
  const podRow = await db.select().from(pods).where(eq(pods.id, podId)).limit(1);
  if (!podRow[0]) throw new NotFoundError('Pod not found');

  const members = await db
    .select({
      podId: podMembers.podId,
      personId: podMembers.personId,
      role: podMembers.role,
      joinedAt: podMembers.joinedAt,
      displayName: persons.displayName,
      avatarUrl: persons.avatarUrl,
    })
    .from(podMembers)
    .innerJoin(persons, eq(persons.id, podMembers.personId))
    .where(and(eq(podMembers.podId, podId), isNotNull(podMembers.joinedAt)));

  void personId;
  return {
    pod: toPodDto(podRow[0]),
    members: members.map((m) => ({
      podId: m.podId,
      personId: m.personId,
      role: m.role as 'admin' | 'member',
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
    })),
  };
}

export async function updatePod(
  podId: string,
  input: Partial<CreatePodInput>,
): Promise<PodDto> {
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) updates[k] = v;
  }
  const [row] = await db.update(pods).set(updates).where(eq(pods.id, podId)).returning();
  if (!row) throw new NotFoundError('Pod not found');
  return toPodDto(row);
}

/**
 * Mint a pod invite record. Pods are horizontal — any current pod member can
 * invite (the route layer's requirePodMember middleware enforces this). The
 * resulting token is a bearer credential: anyone with the link can later
 * accept via the unified /api/invites/:token/accept endpoint.
 */
export async function createPodInviteRecord(
  podId: string,
  inviterId: string,
  displayHint?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + POD_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(invites).values({
    kind: 'pod',
    invitedBy: inviterId,
    podId,
    token,
    inviteeDisplayHint: displayHint ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export type InviteRow = typeof invites.$inferSelect;

/**
 * Apply a pre-validated pod invite: add the accepter to pod_members (or
 * reactivate their row if they previously left), and mark the invite
 * accepted. The caller (invites.service) is responsible for token lookup,
 * expiry/revocation, and dispatching to this helper based on `kind`.
 */
export async function materializePodMembershipFromInvite(
  invite: InviteRow,
  acceptingPersonId: string,
): Promise<{ podId: string }> {
  if (invite.kind !== 'pod') {
    throw new ValidationError('Invite is not a pod invite');
  }
  if (!invite.podId) {
    throw new ValidationError('Pod invite missing pod reference');
  }
  const podId = invite.podId;

  const [existing] = await db
    .select()
    .from(podMembers)
    .where(and(eq(podMembers.podId, podId), eq(podMembers.personId, acceptingPersonId)))
    .limit(1);
  if (existing) {
    if (existing.joinedAt) throw new ConflictError('Already a pod member');
    await db
      .update(podMembers)
      .set({ joinedAt: new Date() })
      .where(and(eq(podMembers.podId, podId), eq(podMembers.personId, acceptingPersonId)));
  } else {
    await db.insert(podMembers).values({
      podId,
      personId: acceptingPersonId,
      role: 'member',
      joinedAt: new Date(),
    });
  }

  await db
    .update(invites)
    .set({ acceptedAt: new Date(), acceptedBy: acceptingPersonId })
    .where(eq(invites.id, invite.id));

  return { podId };
}

export async function getPodPrefs(podId: string): Promise<PodPrefDto> {
  const rows = await db.select().from(podPreferences).where(eq(podPreferences.podId, podId)).limit(1);
  const row = rows[0];
  if (!row) {
    // Auto-create if missing.
    const [created] = await db.insert(podPreferences).values({ podId }).returning();
    if (!created) throw new Error('Failed to init pod prefs');
    return toPodPrefDto(created);
  }
  return toPodPrefDto(row);
}

export async function updatePodPrefs(
  podId: string,
  input: Partial<{
    prefFullGatheringsPerCycle: number;
    prefGatheringDurationHours: number;
    subgroupConfigs: SubgroupConfig[];
  }>,
): Promise<PodPrefDto> {
  await getPodPrefs(podId); // ensures row exists
  const updates: Record<string, unknown> = {};
  if (input.prefFullGatheringsPerCycle !== undefined)
    updates.prefFullGatheringsPerCycle = input.prefFullGatheringsPerCycle;
  if (input.prefGatheringDurationHours !== undefined)
    updates.prefGatheringDurationHours = String(input.prefGatheringDurationHours);
  if (input.subgroupConfigs !== undefined) updates.subgroupConfigs = input.subgroupConfigs;

  const [row] = await db
    .update(podPreferences)
    .set(updates)
    .where(eq(podPreferences.podId, podId))
    .returning();
  if (!row) throw new NotFoundError('Pod preferences not found');
  return toPodPrefDto(row);
}

export async function assertPodAdmin(personId: string, podId: string): Promise<void> {
  const rows = await db
    .select()
    .from(podMembers)
    .where(and(eq(podMembers.podId, podId), eq(podMembers.personId, personId)))
    .limit(1);
  if (!rows[0] || rows[0].role !== 'admin' || !rows[0].joinedAt) {
    throw new ForbiddenError('Admin access required');
  }
}

// ─── DTO mappers ──────────────────────────────────────────────────

function toPodDto(row: typeof pods.$inferSelect): PodDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    emoji: row.emoji ?? '🏠',
    schedulingCadence: row.schedulingCadence,
    planningHorizonWeeks: row.planningHorizonWeeks,
    reviewWindowHours: row.reviewWindowHours,
    cycleDayOfWeek: row.cycleDayOfWeek,
    cycleTimeOfDay: row.cycleTimeOfDay,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPodPrefDto(row: typeof podPreferences.$inferSelect): PodPrefDto {
  return {
    id: row.id,
    podId: row.podId,
    prefFullGatheringsPerCycle: row.prefFullGatheringsPerCycle,
    prefGatheringDurationHours: Number(row.prefGatheringDurationHours),
    subgroupConfigs: (row.subgroupConfigs as SubgroupConfig[]) ?? [],
  };
}
