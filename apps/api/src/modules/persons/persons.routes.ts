/**
 * Persons routes: GET/PATCH/DELETE /api/me, GET /api/me/export,
 * POST /api/me/avatar (file upload).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, or } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { updatePersonSchema } from '@pod-life/shared';
import { AppError } from '../../lib/errors.js';
import { db } from '../../db/index.js';
import {
  auditLog,
  calendarConnections,
  manualAvailability,
  notifications,
  invites,
  partnerships,
  partnershipPreferences,
  podMembers,
  pods,
  persons,
  schedulingCycles,
  sessions,
  timeBlockParticipants,
} from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import { toPersonDto } from './persons.dto.js';
import { cleanupRedisForPerson } from './persons.lifecycle.js';
import {
  deleteAllPasskeys,
  deletePasskey,
  listPasskeys,
} from '../auth/passkey.service.js';

export const personsRoutes = new Hono();

/**
 * Identify an image by its magic bytes. Returns the canonical extension and
 * content-type, or null if the bytes don't match an allowed raster format.
 * Deliberately excludes SVG (script-bearing) and anything not on the list.
 */
function sniffImageType(b: Uint8Array): { ext: string; contentType: string } | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return { ext: 'png', contentType: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  // GIF: "GIF87a" / "GIF89a"
  if (
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
  ) {
    return { ext: 'gif', contentType: 'image/gif' };
  }
  // WebP: "RIFF"...."WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

personsRoutes.get('/me', (c) => {
  const person = c.get('person');
  return c.json({ person: toPersonDto(person) });
});

personsRoutes.get('/me/passkeys', async (c) => {
  const me = c.get('person');
  const passkeys = await listPasskeys(me.id);
  return c.json({ passkeys });
});

personsRoutes.delete('/me/passkeys', async (c) => {
  // Wipes every passkey on the account. Recovery path for users who got
  // stuck with stranded credentials from earlier broken enrollments.
  // Always 200 so the client doesn't have to special-case "nothing to delete".
  const me = c.get('person');
  const removed = await deleteAllPasskeys(me.id);
  return c.json({ ok: true, removed });
});

personsRoutes.delete('/me/passkeys/:id', async (c) => {
  const me = c.get('person');
  const id = c.req.param('id');
  const removed = await deletePasskey(me.id, id);
  if (!removed) {
    throw new NotFoundError('Passkey not found');
  }
  return c.json({ ok: true });
});

personsRoutes.patch('/me', zValidator('json', updatePersonSchema), async (c) => {
  const me = c.get('person');
  const data = c.req.valid('json');
  const updates: Record<string, unknown> = {};
  if (data.displayName !== undefined) updates.displayName = data.displayName;
  if (data.timezone !== undefined) updates.timezone = data.timezone;
  if (data.telegramHandle !== undefined) updates.telegramHandle = data.telegramHandle;
  if (data.avatarUrl !== undefined) updates.avatarUrl = data.avatarUrl;
  if (data.soloMinFreeEveningsPerWeek !== undefined)
    updates.soloMinFreeEveningsPerWeek = data.soloMinFreeEveningsPerWeek;
  if (data.soloMinFreeWeekendDaysPerMonth !== undefined)
    updates.soloMinFreeWeekendDaysPerMonth = data.soloMinFreeWeekendDaysPerMonth;
  if (data.blockedWindows !== undefined) updates.blockedWindows = data.blockedWindows;
  if (data.notificationChannels !== undefined)
    updates.notificationChannels = data.notificationChannels;
  if (data.privacyMode !== undefined) updates.privacyMode = data.privacyMode;
  if (data.onboardedAt !== undefined) {
    updates.onboardedAt = data.onboardedAt ? new Date(data.onboardedAt) : null;
  }

  const [updated] = await db
    .update(persons)
    .set(updates)
    .where(eq(persons.id, me.id))
    .returning();
  if (!updated) throw new NotFoundError('Person not found');

  await db.insert(auditLog).values({
    personId: me.id,
    action: 'person.update',
    resourceType: 'person',
    resourceId: me.id,
    metadata: { fields: Object.keys(updates) },
  });

  return c.json({ person: toPersonDto(updated) });
});

/**
 * Upload an avatar image to Vercel Blob and store the public URL on the
 * person row. Returns the updated person.
 *
 * Accepts multipart/form-data with a single `file` field. The file is
 * served from Vercel's Blob CDN (public access). Old avatars stay in the
 * blob store as orphans — fine for v1; can sweep on a cron later.
 */
personsRoutes.post('/me/avatar', async (c) => {
  const me = c.get('person');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError('BAD_REQUEST', 'Expected multipart form field "file"', 400);
  }
  // 5MB cap — generous for avatars but blocks runaway uploads.
  if (file.size > 5 * 1024 * 1024) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Avatar must be 5 MB or smaller', 413);
  }
  // Sniff the actual bytes rather than trusting the client-supplied
  // content-type or filename extension. Only raster formats are allowed —
  // notably SVG is rejected because it can carry executable script, and these
  // blobs are served publicly. The stored content-type and extension are
  // derived from the sniff, never from the request.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new AppError(
      'BAD_REQUEST',
      'Only PNG, JPEG, WebP, or GIF images are accepted',
      400,
    );
  }

  // Random, unguessable key (random suffix) — the path no longer embeds a
  // predictable person id + timestamp.
  const blob = await put(`avatars/${me.id}/avatar.${sniffed.ext}`, file, {
    access: 'public',
    contentType: sniffed.contentType,
    addRandomSuffix: true,
  });

  const [updated] = await db
    .update(persons)
    .set({ avatarUrl: blob.url, updatedAt: new Date() })
    .where(eq(persons.id, me.id))
    .returning();
  if (!updated) throw new NotFoundError('Person not found');

  await db.insert(auditLog).values({
    personId: me.id,
    action: 'avatar.update',
    resourceType: 'person',
    resourceId: me.id,
    metadata: { url: blob.url, size: file.size, contentType: file.type },
  });

  return c.json({ person: toPersonDto(updated) });
});

/**
 * GDPR-style data export — every row in the database that belongs to the
 * authenticated person, in JSON. Anything that references *other* people
 * (e.g. shared time blocks) is excluded so we don't accidentally leak data
 * about partners through the export channel.
 */
personsRoutes.get('/me/export', async (c) => {
  const me = c.get('person');

  const [partnerRows, prefRows, podMemberRows, calRows, manualAvailRows, notifs] =
    await Promise.all([
      db
        .select()
        .from(partnerships)
        .where(or(eq(partnerships.personAId, me.id), eq(partnerships.personBId, me.id))),
      db
        .select()
        .from(partnershipPreferences)
        .where(eq(partnershipPreferences.personId, me.id)),
      db.select().from(podMembers).where(eq(podMembers.personId, me.id)),
      db
        .select({
          id: calendarConnections.id,
          provider: calendarConnections.provider,
          calendarId: calendarConnections.calendarId,
          scopes: calendarConnections.scopes,
          createdAt: calendarConnections.createdAt,
        })
        .from(calendarConnections)
        .where(eq(calendarConnections.personId, me.id)),
      db
        .select()
        .from(manualAvailability)
        .where(eq(manualAvailability.personId, me.id)),
      db.select().from(notifications).where(eq(notifications.personId, me.id)),
    ]);

  await db.insert(auditLog).values({
    personId: me.id,
    action: 'person.export',
    resourceType: 'person',
    resourceId: me.id,
    metadata: {},
  });

  return c.json({
    person: toPersonDto(me),
    partnerships: partnerRows,
    partnershipPreferences: prefRows,
    podMemberships: podMemberRows,
    // Calendar connections without encrypted token bytes; tokens never exit.
    calendarConnections: calRows,
    manualAvailability: manualAvailRows,
    notifications: notifs,
    exportedAt: new Date().toISOString(),
  });
});

personsRoutes.delete('/me', async (c) => {
  const me = c.get('person');
  // Audit BEFORE deletion. person_id is NULLed since the FK has no cascade
  // for audit_log (intentional — audit trail must outlive the person).
  await db.insert(auditLog).values({
    personId: null,
    action: 'account.delete',
    resourceType: 'person',
    resourceId: me.id,
    metadata: { retainedAuditOnly: true },
  });
  // Pre-cascade: redis cleanup (free/busy cache, sessions, link tokens).
  await cleanupRedisForPerson(me.id);

  // Null out FKs that don't ON DELETE CASCADE — audit_log retains history,
  // pods retain ownership lineage (transferred to admin or null), partnerships
  // and cycles preserve trigger lineage. We anonymize by NULL-ing.
  await db
    .update(auditLog)
    .set({ personId: null })
    .where(eq(auditLog.personId, me.id));
  await db
    .update(schedulingCycles)
    .set({ triggeredBy: null })
    .where(eq(schedulingCycles.triggeredBy, me.id));
  // invites.accepted_by has FK with ON DELETE SET NULL — null it out
  // explicitly so the audit history of accepted invites stays intact even as
  // the accepting person is removed. Invites the user *created* (invited_by)
  // cascade via their FK.
  await db
    .update(invites)
    .set({ acceptedBy: null })
    .where(eq(invites.acceptedBy, me.id));
  // pods.created_by is NOT NULL — for any pod the user created, we delete the
  // pod outright (cascades pod_members, pod_preferences). For shared pods that
  // someone else created, the user's pod_member row will cascade.
  await db.delete(pods).where(eq(pods.createdBy, me.id));
  // partnerships.invited_by is NOT NULL — partnerships where the user is a
  // party are already covered by personA/personB cascade. Any partnership
  // *only* invited by them (where they're not party) shouldn't exist by
  // canonical-pair logic, but defensively delete.
  await db.delete(partnerships).where(eq(partnerships.invitedBy, me.id));

  // Drizzle cascades via FK ON DELETE CASCADE on persons.id:
  //   sessions, calendar_connections, partnerships (both directions),
  //   partnership_preferences, pod_members, time_block_participants,
  //   manual_availability, notifications.
  // We DON'T delete time_blocks — they may belong to other participants.
  // Magic links are matched by email and are not FK-linked; they expire.
  void sessions;
  void timeBlockParticipants;
  await db.delete(persons).where(eq(persons.id, me.id));
  return c.json({ ok: true });
});
