/**
 * Unified invite service. Owns the `invites` table — token lookup, validity
 * (expiry / revocation / single-use), and dispatching to the kind-specific
 * resource materializer in partners.service or pods.service.
 *
 * Privacy invariant (CLAUDE.md § Privacy Model):
 *   - The public preview leaks only `inviterDisplayName`, `kind`, and
 *     `podName` (when kind='pod'). Never the inviter's email, the pod's
 *     members, the partner-list of the inviter, or any field unrelated to
 *     identifying *which invitation this is*.
 *   - The inviter's private `inviteeDisplayHint` is NEVER exposed to the
 *     accepter — it's a label only the inviter sees in their dashboard.
 */
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { RelationshipType } from '@pod-life/shared';
import { db } from '../../db/index.js';
import { invites, persons, pods, podMembers } from '../../db/schema.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import {
  createPartnerInvite,
  materializePartnershipFromInvite,
} from '../partners/partners.service.js';
import {
  createPodInviteRecord,
  materializePodMembershipFromInvite,
} from '../pods/pods.service.js';

export type InviteKind = 'partner' | 'pod';

export interface CreateInviteParams {
  kind: InviteKind;
  /** Required when kind='partner'. Defaults to 'partnership' if omitted. */
  relationshipType?: RelationshipType;
  /** Required when kind='pod'. */
  podId?: string;
  /** Optional freeform label shown only to the inviter. */
  displayHint?: string;
}

export interface CreateInviteResult {
  token: string;
  expiresAt: Date;
  kind: InviteKind;
}

export interface InvitePreview {
  kind: InviteKind;
  inviterDisplayName: string;
  /** Only set when kind='pod'. */
  podName?: string;
  /** Only set when kind='partner' — 'partnership' or 'friendship'. */
  relationshipType?: RelationshipType;
  expiresAt: string;
}

export interface AcceptResult {
  kind: InviteKind;
  partnershipId?: string;
  podId?: string;
}

export interface ListedInvite {
  token: string;
  kind: InviteKind;
  podId: string | null;
  podName: string | null;
  relationshipType: RelationshipType | null;
  displayHint: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByDisplayName: string | null;
  revokedAt: string | null;
}

/**
 * Mint a new invite. For pod invites, caller must be a member of `podId` —
 * checked here defensively as well as at the route layer (defense in depth).
 */
export async function createInvite(
  inviterId: string,
  params: CreateInviteParams,
): Promise<CreateInviteResult> {
  if (params.kind === 'partner') {
    const { token, expiresAt } = await createPartnerInvite(
      inviterId,
      params.displayHint,
      params.relationshipType ?? 'partnership',
    );
    return { token, expiresAt, kind: 'partner' };
  }

  if (!params.podId) {
    throw new ValidationError('podId required for pod invites');
  }
  await assertPodMembership(inviterId, params.podId);
  const { token, expiresAt } = await createPodInviteRecord(
    params.podId,
    inviterId,
    params.displayHint,
  );
  return { token, expiresAt, kind: 'pod' };
}

/**
 * Public preview — no auth. Returns only the minimum needed for the landing
 * page to render: who invited you, what you're being invited to. Never
 * leaks pod membership lists or anything beyond the invite's own identity.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const [row] = await db
    .select({
      kind: invites.kind,
      podId: invites.podId,
      relationshipType: invites.relationshipType,
      expiresAt: invites.expiresAt,
      revokedAt: invites.revokedAt,
      acceptedAt: invites.acceptedAt,
      inviterDisplayName: persons.displayName,
    })
    .from(invites)
    .innerJoin(persons, eq(persons.id, invites.invitedBy))
    .where(eq(invites.token, token))
    .limit(1);
  if (!row) throw new NotFoundError('Invite not found');
  if (row.revokedAt) throw new NotFoundError('Invite revoked');
  if (row.acceptedAt) throw new ConflictError('Invite already accepted');
  if (row.expiresAt < new Date()) throw new NotFoundError('Invite expired');

  let podName: string | undefined;
  if (row.kind === 'pod' && row.podId) {
    const [p] = await db
      .select({ name: pods.name })
      .from(pods)
      .where(eq(pods.id, row.podId))
      .limit(1);
    podName = p?.name ?? undefined;
  }

  return {
    kind: row.kind as InviteKind,
    inviterDisplayName: row.inviterDisplayName,
    podName,
    relationshipType: (row.relationshipType as RelationshipType | null) ?? undefined,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Accept an invite. Auth required. Dispatches by kind to the appropriate
 * materializer. The accept is idempotent only in the sense that re-trying
 * after success returns 409 (already accepted) — we never silently no-op.
 */
export async function acceptInvite(
  acceptingPersonId: string,
  token: string,
): Promise<AcceptResult> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.token, token), gt(invites.expiresAt, new Date())))
    .limit(1);
  if (!invite) throw new NotFoundError('Invite not found or expired');
  if (invite.revokedAt) throw new NotFoundError('Invite revoked');
  if (invite.acceptedAt) throw new ConflictError('Invite already accepted');
  if (invite.invitedBy === acceptingPersonId) {
    throw new ValidationError('Cannot accept your own invite');
  }

  if (invite.kind === 'partner') {
    const { partnershipId } = await materializePartnershipFromInvite(invite, acceptingPersonId);
    return { kind: 'partner', partnershipId };
  }
  if (invite.kind === 'pod') {
    const { podId } = await materializePodMembershipFromInvite(invite, acceptingPersonId);
    return { kind: 'pod', podId };
  }
  throw new ValidationError(`Unknown invite kind: ${invite.kind}`);
}

/**
 * Revoke an invite I created. Only the inviter can revoke. Idempotent on
 * already-accepted invites (they cannot be revoked retroactively — accept
 * is final).
 */
export async function revokeInvite(personId: string, token: string): Promise<void> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, token))
    .limit(1);
  if (!invite) throw new NotFoundError('Invite not found');
  if (invite.invitedBy !== personId) {
    throw new ForbiddenError('Only the inviter can revoke this invite');
  }
  if (invite.acceptedAt) {
    throw new ConflictError('Invite already accepted — cannot revoke');
  }
  if (invite.revokedAt) return; // already revoked, no-op
  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, invite.id));
}

/**
 * List invites I created. Used by the inviter's dashboard to see outstanding
 * invites with their displayHint labels and current status.
 */
export async function listMyInvites(personId: string): Promise<ListedInvite[]> {
  const rows = await db
    .select({
      token: invites.token,
      kind: invites.kind,
      podId: invites.podId,
      podName: pods.name,
      relationshipType: invites.relationshipType,
      displayHint: invites.inviteeDisplayHint,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      acceptedById: invites.acceptedBy,
      revokedAt: invites.revokedAt,
    })
    .from(invites)
    .leftJoin(pods, eq(pods.id, invites.podId))
    .where(eq(invites.invitedBy, personId))
    .orderBy(desc(invites.createdAt));

  // Resolve acceptedBy → display name only when set, in a single follow-up
  // query keyed by personId. Saves N+1 versus per-row joins.
  const acceptedIds = rows.map((r) => r.acceptedById).filter((x): x is string => !!x);
  const accepterNames = new Map<string, string>();
  if (acceptedIds.length > 0) {
    const namesRows = await db
      .select({ id: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(inArray(persons.id, acceptedIds));
    for (const r of namesRows) accepterNames.set(r.id, r.displayName);
  }

  return rows.map((r) => ({
    token: r.token,
    kind: r.kind as InviteKind,
    podId: r.podId,
    podName: r.podName,
    relationshipType: r.relationshipType as RelationshipType | null,
    displayHint: r.displayHint,
    expiresAt: r.expiresAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    acceptedByDisplayName: r.acceptedById ? accepterNames.get(r.acceptedById) ?? null : null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

async function assertPodMembership(personId: string, podId: string): Promise<void> {
  const [row] = await db
    .select({ podId: podMembers.podId })
    .from(podMembers)
    .where(and(eq(podMembers.podId, podId), eq(podMembers.personId, personId)))
    .limit(1);
  if (!row) throw new ForbiddenError('Not a member of this pod');
}

