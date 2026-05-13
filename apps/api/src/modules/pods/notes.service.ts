/**
 * Pod notes service: longer-form, editable shared notes for a pod.
 *
 * Notes differ from chat messages in three ways:
 *  - Longer body (up to 5000 chars).
 *  - Mutable: the author can edit (PATCH) and delete.
 *  - Listed newest-first (the UI shows them as a feed of "thoughts").
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { podNotes, persons } from '../../db/schema.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { notifyOtherPodMembers } from './chat.service.js';
import { logger } from '../../lib/logger.js';

export interface NoteDto {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export async function listNotes(podId: string): Promise<NoteDto[]> {
  const rows = await db
    .select({
      id: podNotes.id,
      authorId: podNotes.authorId,
      body: podNotes.body,
      createdAt: podNotes.createdAt,
      updatedAt: podNotes.updatedAt,
      authorName: persons.displayName,
    })
    .from(podNotes)
    .leftJoin(persons, eq(persons.id, podNotes.authorId))
    .where(eq(podNotes.podId, podId))
    .orderBy(desc(podNotes.createdAt));
  return rows.map((r) => ({
    id: r.id,
    authorId: r.authorId,
    authorName: r.authorName ?? 'Deleted user',
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createNote(
  podId: string,
  authorId: string,
  body: string,
): Promise<NoteDto> {
  const [row] = await db.insert(podNotes).values({ podId, authorId, body }).returning();
  if (!row) throw new Error('Failed to create note');

  const authorRows = await db
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, authorId))
    .limit(1);
  const authorName = authorRows[0]?.displayName ?? 'Deleted user';

  // Notify other pod members (best-effort).
  void notifyOtherPodMembers(podId, authorId, {
    title: `${authorName} added a pod note`,
    body: truncate(body, 80),
    actionUrl: `/pods/${podId}`,
  }).catch((err) => {
    logger.warn('pod note notification failed', { podId, err: (err as Error).message });
  });

  return {
    id: row.id,
    authorId: row.authorId,
    authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateNote(
  podId: string,
  authorId: string,
  noteId: string,
  body: string,
): Promise<NoteDto> {
  const rows = await db
    .select()
    .from(podNotes)
    .where(and(eq(podNotes.id, noteId), eq(podNotes.podId, podId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Note not found');
  if (row.authorId !== authorId) throw new ForbiddenError('Only the author can edit this note');

  const [updated] = await db
    .update(podNotes)
    .set({ body, updatedAt: new Date() })
    .where(eq(podNotes.id, noteId))
    .returning();
  if (!updated) throw new NotFoundError('Note not found');

  const authorRows = await db
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, authorId))
    .limit(1);
  const authorName = authorRows[0]?.displayName ?? 'Deleted user';

  return {
    id: updated.id,
    authorId: updated.authorId,
    authorName,
    body: updated.body,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function deleteNote(
  podId: string,
  authorId: string,
  noteId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(podNotes)
    .where(and(eq(podNotes.id, noteId), eq(podNotes.podId, podId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Note not found');
  if (row.authorId !== authorId) throw new ForbiddenError('Only the author can delete this note');
  await db.delete(podNotes).where(eq(podNotes.id, noteId));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
