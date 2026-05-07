/**
 * Pod notes routes: GET / POST / PATCH / DELETE under /api/pods/:id/notes.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requirePodMember } from '../../middleware/pod-access.middleware.js';
import { createNote, deleteNote, listNotes, updateNote } from './notes.service.js';

export const notesRoutes = new Hono();

const bodySchema = z.object({
  body: z.string().min(1).max(5000),
});

notesRoutes.get('/:id/notes', requirePodMember(), async (c) => {
  const podId = c.req.param('id');
  const notes = await listNotes(podId);
  return c.json({ notes });
});

notesRoutes.post(
  '/:id/notes',
  requirePodMember(),
  zValidator('json', bodySchema),
  async (c) => {
    const me = c.get('person');
    const podId = c.req.param('id');
    const { body } = c.req.valid('json');
    const note = await createNote(podId, me.id, body);
    return c.json({ note });
  },
);

notesRoutes.patch(
  '/:id/notes/:noteId',
  requirePodMember(),
  zValidator('json', bodySchema),
  async (c) => {
    const me = c.get('person');
    const podId = c.req.param('id');
    const noteId = c.req.param('noteId');
    const { body } = c.req.valid('json');
    const note = await updateNote(podId, me.id, noteId, body);
    return c.json({ note });
  },
);

notesRoutes.delete('/:id/notes/:noteId', requirePodMember(), async (c) => {
  const me = c.get('person');
  const podId = c.req.param('id');
  const noteId = c.req.param('noteId');
  await deleteNote(podId, me.id, noteId);
  return c.body(null, 204);
});
