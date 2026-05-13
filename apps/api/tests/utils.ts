/**
 * Shared test utilities. The tests run against the live local dev DB.
 * Each test should clean up persons it creates by email.
 */
import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';
import {
  auditLog,
  persons,
  pods,
  podMembers,
  schedulingCycles,
  partnerships,
} from '../src/db/schema.ts';
import { requestLoginCode, verifyLoginCode } from '../src/modules/auth/login-code.service.ts';

export function newApp(): Hono {
  return buildApp();
}

export async function createTestPerson(email: string): Promise<{
  sessionToken: string;
  personId: string;
}> {
  const result = await requestLoginCode(email);
  if (!result.devToken) throw new Error('expected devToken in non-prod');
  const verified = await verifyLoginCode(email, result.devToken);
  return { sessionToken: verified.sessionToken, personId: verified.person.id };
}

export async function deletePerson(email: string): Promise<void> {
  // Resolve id, then unhook references that don't ON DELETE CASCADE.
  const found = await db.select().from(persons).where(eq(persons.email, email)).limit(1);
  const p = found[0];
  if (!p) return;
  // FKs without ON DELETE CASCADE that reference persons.
  await db
    .delete(schedulingCycles)
    .where(eq(schedulingCycles.triggeredBy, p.id));
  await db.delete(partnerships).where(eq(partnerships.invitedBy, p.id));
  await db.delete(pods).where(eq(pods.createdBy, p.id));
  // audit_log.person_id is nullable — null it out rather than deleting rows
  // (audit trail preserved).
  await db
    .update(auditLog)
    .set({ personId: null })
    .where(eq(auditLog.personId, p.id));
  await db.delete(persons).where(eq(persons.id, p.id));
  void sql;
}

export interface TestRequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  json?: unknown;
  token?: string;
}

export async function call(
  app: Hono,
  path: string,
  opts: TestRequestOpts = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  const res = await app.request(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}+${Date.now()}.${Math.floor(Math.random() * 1e6)}@podlife.local`;
}

/**
 * V-structure fixture used by the privacy boundary suite (P9.1).
 *
 *   A is in Pod1 with B   (active partnership A↔B)
 *   A is in Pod2 with C   (active partnership A↔C)
 *   B and C share NO pod and have NO partnership.
 *
 * Privacy invariant: B must never see any evidence of C (and vice versa).
 */
export interface VStructure {
  a: { sessionToken: string; personId: string; email: string; displayName: string };
  b: { sessionToken: string; personId: string; email: string; displayName: string };
  c: { sessionToken: string; personId: string; email: string; displayName: string };
  pod1Id: string; // contains A + B
  pod2Id: string; // contains A + C
  abPartnershipId: string;
  acPartnershipId: string;
  app: Hono;
}

export async function createVStructure(): Promise<VStructure> {
  const app = newApp();
  // Create three persons with distinct, unmistakable display names so any
  // mention by another person is unambiguous in test assertions.
  const aEmail = uniqueEmail('priv-a');
  const bEmail = uniqueEmail('priv-b');
  const cEmail = uniqueEmail('priv-c');
  const aSession = await createTestPerson(aEmail);
  const bSession = await createTestPerson(bEmail);
  const cSession = await createTestPerson(cEmail);

  // Set unique display names so we can grep responses for cross-pod leakage.
  // Use names that are unlikely to appear in any system message text.
  const aName = `Aurelius${Date.now()}`;
  const bName = `Bellatrix${Date.now()}`;
  const cName = `Caspian${Date.now()}`;
  await db.update(persons).set({ displayName: aName }).where(eq(persons.id, aSession.personId));
  await db.update(persons).set({ displayName: bName }).where(eq(persons.id, bSession.personId));
  await db.update(persons).set({ displayName: cName }).where(eq(persons.id, cSession.personId));

  // Partnership A↔B
  const abInvite = await call(app, '/api/invites', {
    method: 'POST',
    token: aSession.sessionToken,
    json: { kind: 'partner', displayHint: 'B' },
  });
  const abAccept = await call(app, `/api/invites/${abInvite.body.token}/accept`, {
    method: 'POST',
    token: bSession.sessionToken,
  });

  // Partnership A↔C
  const acInvite = await call(app, '/api/invites', {
    method: 'POST',
    token: aSession.sessionToken,
    json: { kind: 'partner', displayHint: 'C' },
  });
  const acAccept = await call(app, `/api/invites/${acInvite.body.token}/accept`, {
    method: 'POST',
    token: cSession.sessionToken,
  });

  // Pod1 (A + B)
  const pod1 = await call(app, '/api/pods', {
    method: 'POST',
    token: aSession.sessionToken,
    json: { name: `Hearth-${Date.now()}` },
  });
  const pod1Invite = await call(app, '/api/invites', {
    method: 'POST',
    token: aSession.sessionToken,
    json: { kind: 'pod', podId: pod1.body.pod.id },
  });
  await call(app, `/api/invites/${pod1Invite.body.token}/accept`, {
    method: 'POST',
    token: bSession.sessionToken,
  });

  // Pod2 (A + C)
  const pod2 = await call(app, '/api/pods', {
    method: 'POST',
    token: aSession.sessionToken,
    json: { name: `Garden-${Date.now()}` },
  });
  const pod2Invite = await call(app, '/api/invites', {
    method: 'POST',
    token: aSession.sessionToken,
    json: { kind: 'pod', podId: pod2.body.pod.id },
  });
  await call(app, `/api/invites/${pod2Invite.body.token}/accept`, {
    method: 'POST',
    token: cSession.sessionToken,
  });

  return {
    app,
    a: { ...aSession, email: aEmail, displayName: aName },
    b: { ...bSession, email: bEmail, displayName: bName },
    c: { ...cSession, email: cEmail, displayName: cName },
    pod1Id: pod1.body.pod.id,
    pod2Id: pod2.body.pod.id,
    abPartnershipId: abAccept.body.partnershipId,
    acPartnershipId: acAccept.body.partnershipId,
  };
}

/**
 * Recursively walk an object and collect every string value. Useful for
 * "does this response leak the name X anywhere" assertions.
 */
export function collectStrings(value: unknown): string[] {
  const out: string[] = [];
  function walk(v: unknown): void {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  }
  walk(value);
  return out;
}

void podMembers; // tests may import; reserved for direct DB seeding

