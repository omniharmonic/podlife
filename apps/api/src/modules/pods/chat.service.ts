/**
 * Pod chat service: short, fast messages between pod members.
 *
 * Privacy: every operation is gated by pod-membership middleware before it
 * reaches this service. Messages never leave the pod scope. The author may be
 * NULL (account deleted); the read API surfaces "Deleted user" in that case.
 */
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  podChatMessages,
  podMembers,
  persons,
  pods,
} from '../../db/schema.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { send as notify } from '../../services/notification/notification.service.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

export interface ChatMessageDto {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export async function listMessages(
  podId: string,
  opts: { limit?: number; before?: Date } = {},
): Promise<ChatMessageDto[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  // Fetch newest-first (using the index), then reverse so the API returns
  // oldest-first (newest at the bottom) — the UI appends to the bottom.
  const where = opts.before
    ? and(eq(podChatMessages.podId, podId), lt(podChatMessages.createdAt, opts.before))
    : eq(podChatMessages.podId, podId);

  const rows = await db
    .select({
      id: podChatMessages.id,
      authorId: podChatMessages.authorId,
      body: podChatMessages.body,
      createdAt: podChatMessages.createdAt,
      authorName: persons.displayName,
    })
    .from(podChatMessages)
    .leftJoin(persons, eq(persons.id, podChatMessages.authorId))
    .where(where)
    .orderBy(desc(podChatMessages.createdAt))
    .limit(limit);

  // Reverse for newest-last display ordering.
  return rows
    .map((r) => ({
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName ?? 'Deleted user',
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    }))
    .reverse();
}

export async function postMessage(
  podId: string,
  authorId: string,
  body: string,
): Promise<ChatMessageDto> {
  const [row] = await db
    .insert(podChatMessages)
    .values({ podId, authorId, body })
    .returning();
  if (!row) throw new Error('Failed to insert message');

  const authorRows = await db
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, authorId))
    .limit(1);
  const authorName = authorRows[0]?.displayName ?? 'Deleted user';

  // Notify all OTHER pod members (best-effort; failures don't bubble).
  void notifyOtherPodMembers(podId, authorId, {
    title: `${authorName} in pod chat`,
    body: truncate(body, 80),
    actionUrl: `${config.frontendUrl}/pods/${podId}`,
  }).catch((err) => {
    logger.warn('pod chat notification failed', { podId, err: (err as Error).message });
  });

  return {
    id: row.id,
    authorId: row.authorId,
    authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteMessage(
  podId: string,
  authorId: string,
  messageId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(podChatMessages)
    .where(and(eq(podChatMessages.id, messageId), eq(podChatMessages.podId, podId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Message not found');
  if (row.authorId !== authorId) {
    throw new ForbiddenError('Only the author can delete this message');
  }
  await db.delete(podChatMessages).where(eq(podChatMessages.id, messageId));
}

/**
 * Send a notification to every member of the pod EXCEPT the actor. Used by
 * both pod chat (new message) and pod notes (note added).
 */
export async function notifyOtherPodMembers(
  podId: string,
  exceptPersonId: string,
  payload: { title: string; body: string; actionUrl: string },
): Promise<void> {
  const members = await db
    .select({ personId: podMembers.personId })
    .from(podMembers)
    .where(and(eq(podMembers.podId, podId), ne(podMembers.personId, exceptPersonId)));
  // Pull pod name only for sanity (and to avoid leaking it across pods — we
  // already scope by podId so the title/body is the only outbound text).
  void pods;
  await Promise.all(
    members.map((m) =>
      notify(m.personId, {
        title: payload.title,
        body: payload.body,
        actionUrl: payload.actionUrl,
        channels: ['in_app'],
      }),
    ),
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
