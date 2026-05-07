/**
 * Pods service: create pods, manage members, manage prefs.
 */
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  POD_INVITE_TTL_DAYS,
  type Pod as PodDto,
  type PodMember as PodMemberDto,
  type PodPreference as PodPrefDto,
  type SubgroupConfig,
} from '@pod-life/shared';
import { db } from '../../db/index.ts';
import {
  podMembers,
  podPreferences,
  pods,
  persons,
} from '../../db/schema.ts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors.ts';
import { config } from '../../lib/config.ts';

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

export async function createPodInvite(
  podId: string,
  inviterId: string,
  role: 'admin' | 'member' = 'member',
): Promise<{ inviteUrl: string; token: string; expiresAt: Date }> {
  void inviterId;
  // Pod invites use the pod_members table with a token and joined_at IS NULL.
  // We instead create a sentinel row using an ephemeral UUID pseudo-person?
  // Simpler: use a dedicated invite token stored against an invite row.
  // We'll piggy-back on pod_members.invite_token but that requires a person_id.
  // Easier: the invite token lives in the partner_invites table conceptually,
  // but it must scope to a pod. We'll create a row in pod_members with a
  // non-existent person_id won't work due to FK. So we use a small lookup
  // table-less approach: encode (podId, role, expiresAt) into a Redis token.
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + POD_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  // Use Redis to keep it simple — no schema change needed.
  const { redis, redisFor } = await import('../../lib/redis.ts');
  const key = redisFor('pod-invite')(token);
  await redis.set(
    key,
    JSON.stringify({ podId, role, expiresAt: expiresAt.toISOString() }),
    Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
  );
  const inviteUrl = `${config.frontendUrl}/pods/join/${token}`;
  return { inviteUrl, token, expiresAt };
}

export async function joinPodWithToken(
  personId: string,
  token: string,
): Promise<{ podId: string }> {
  const { redis, redisFor } = await import('../../lib/redis.ts');
  const key = redisFor('pod-invite')(token);
  const raw = await redis.get(key);
  if (!raw) throw new NotFoundError('Invite not found or expired');
  const data = JSON.parse(raw) as { podId: string; role: 'admin' | 'member'; expiresAt: string };
  if (new Date(data.expiresAt) < new Date()) {
    await redis.del(key);
    throw new NotFoundError('Invite expired');
  }

  // Check if already a member.
  const existing = await db
    .select()
    .from(podMembers)
    .where(and(eq(podMembers.podId, data.podId), eq(podMembers.personId, personId)))
    .limit(1);
  if (existing[0]) {
    if (existing[0].joinedAt) throw new ConflictError('Already a pod member');
    await db
      .update(podMembers)
      .set({ joinedAt: new Date(), role: data.role })
      .where(and(eq(podMembers.podId, data.podId), eq(podMembers.personId, personId)));
  } else {
    await db.insert(podMembers).values({
      podId: data.podId,
      personId,
      role: data.role,
      joinedAt: new Date(),
    });
  }
  // One-shot token.
  await redis.del(key);
  void gt;
  return { podId: data.podId };
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
