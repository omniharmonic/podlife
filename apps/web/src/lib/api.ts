/**
 * Typed fetch wrapper that talks to the API at /api and /auth (proxied to :3000 in dev).
 * Reads the session token from localStorage and adds Authorization header on every request.
 */

import type {
  Person,
  PartnerSummary,
  PartnershipPreference,
  Pod,
  PodPreference,
  TimeBlock,
  FreeWindow,
  SatisfactionReport,
  ParticipantResponse,
  RelationshipType,
  SchedulingCadence,
} from '@pod-life/shared';

const SESSION_TOKEN_KEY = 'podlife.sessionToken';

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  details: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** Skip Authorization header (for /auth endpoints). */
  unauthenticated?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, unauthenticated = false } = opts;

  let url = path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (!unauthenticated) {
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      'Network error — check your connection and try again.',
      0,
      'network_error',
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const p = (payload ?? {}) as Record<string, unknown>;
    const message =
      (typeof p.message === 'string' && p.message) ||
      (typeof p.error === 'string' && p.error) ||
      `Request failed (${res.status})`;
    const code = typeof p.code === 'string' ? p.code : undefined;

    if (res.status === 401 && !unauthenticated) {
      // Token may be expired — clear it. UI listens via storage events / re-renders.
      setSessionToken(null);
    }

    throw new ApiError(message, res.status, code, payload);
  }

  return payload as T;
}

// ─── Endpoint groups ────────────────────────────────────────────────

export const auth = {
  // Request a 6-character sign-in code by email. Replaces the older magic
  // link flow — codes survive the email→browser→PWA boundary that breaks
  // deep links on iOS.
  requestLoginCode(email: string) {
    return request<{ ok: true }>(`/auth/magic-link`, {
      method: 'POST',
      body: { email },
      unauthenticated: true,
    });
  },
  /** Verify a login code (or, in the legacy path, magic-link token). */
  verify(email: string, code: string) {
    return request<{ sessionToken: string; person: Person }>(`/auth/verify`, {
      method: 'POST',
      body: { email, token: code },
      unauthenticated: true,
    });
  },
  logout() {
    return request<{ ok: true }>(`/auth/logout`, { method: 'POST' });
  },
};

export interface PasskeyListItem {
  id: string;
  nickname: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export const passkeys = {
  list() {
    return request<{ passkeys: PasskeyListItem[] }>(`/api/me/passkeys`);
  },
  delete(id: string) {
    return request<{ ok: true }>(`/api/me/passkeys/${id}`, { method: 'DELETE' });
  },
  deleteAll() {
    return request<{ ok: true; removed: number }>(`/api/me/passkeys`, {
      method: 'DELETE',
    });
  },
  // Registration is bound to a logged-in session; the body is a webauthn
  // RegistrationResponseJSON which we pass through opaquely.
  registerOptions() {
    return request<{ options: unknown }>(`/auth/passkey/register/options`, {
      method: 'POST',
      body: {},
    });
  },
  registerVerify(response: unknown, nickname?: string) {
    return request<{ credentialId: string; nickname: string | null }>(
      `/auth/passkey/register/verify`,
      { method: 'POST', body: { response, nickname } },
    );
  },
  authenticateOptions(email?: string) {
    return request<{ options: unknown }>(`/auth/passkey/authenticate/options`, {
      method: 'POST',
      body: email ? { email } : {},
      unauthenticated: true,
    });
  },
  authenticateVerify(response: unknown, email?: string) {
    return request<{ sessionToken: string; person: Person }>(
      `/auth/passkey/authenticate/verify`,
      {
        method: 'POST',
        body: email ? { response, email } : { response },
        unauthenticated: true,
      },
    );
  },
};

export const me = {
  // The API wraps person responses as { person: ... }; unwrap so callers
  // can use the bare Person without each call site re-implementing this.
  async get(): Promise<Person> {
    const r = await request<{ person: Person } | Person>(`/api/me`);
    return 'person' in (r as object) ? (r as { person: Person }).person : (r as Person);
  },
  /**
   * Upload an avatar image. The server pushes it to Vercel Blob and stores
   * the public URL on the person row. Bypasses our `request()` JSON helper
   * because the body is multipart/form-data.
   */
  async uploadAvatar(file: File): Promise<Person> {
    const form = new FormData();
    form.set('file', file);
    const tok = getSessionToken();
    const r = await fetch('/api/me/avatar', {
      method: 'POST',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      body: form,
    });
    if (!r.ok) {
      let msg = 'Upload failed';
      try {
        const j = await r.json();
        msg = j?.error?.message ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(msg, r.status);
    }
    const j = (await r.json()) as { person: Person } | Person;
    return 'person' in (j as object) ? (j as { person: Person }).person : (j as Person);
  },
  async update(patch: Partial<Person>): Promise<Person> {
    const r = await request<{ person: Person } | Person>(`/api/me`, {
      method: 'PATCH',
      body: patch,
    });
    return 'person' in (r as object) ? (r as { person: Person }).person : (r as Person);
  },
  delete() {
    return request<void>(`/api/me`, { method: 'DELETE' });
  },
};

// Many API endpoints wrap their payload in a single-key object like
// `{ pod: ... }`. Centralized unwrap so each call site doesn't reimplement it.
function unwrap<T>(key: string) {
  return (r: unknown): T => {
    if (r && typeof r === 'object' && key in r) return (r as Record<string, T>)[key]!;
    return r as T;
  };
}

export const partners = {
  list() {
    return request<{ partners: PartnerSummary[] }>(`/api/partners`);
  },
  updateRelationshipType(partnershipId: string, relationshipType: RelationshipType) {
    return request<{ id: string; relationshipType: RelationshipType }>(
      `/api/partners/${partnershipId}/type`,
      { method: 'PATCH', body: { relationshipType } },
    );
  },
  proposeCadence(partnershipId: string, cadence: SchedulingCadence) {
    return request<{
      cadence: SchedulingCadence;
      pendingCadence: SchedulingCadence | null;
      pendingCadenceBy: string | null;
    }>(`/api/partners/${partnershipId}/cadence/propose`, {
      method: 'POST',
      body: { cadence },
    });
  },
  acceptCadence(partnershipId: string) {
    return request<{
      cadence: SchedulingCadence;
      pendingCadence: null;
      pendingCadenceBy: null;
    }>(`/api/partners/${partnershipId}/cadence/accept`, {
      method: 'POST',
      body: {},
    });
  },
  declineCadence(partnershipId: string) {
    return request<{
      cadence: SchedulingCadence;
      pendingCadence: null;
      pendingCadenceBy: null;
    }>(`/api/partners/${partnershipId}/cadence/decline`, {
      method: 'POST',
      body: {},
    });
  },
  getPreferences(partnershipId: string) {
    return request<{ preferences: PartnershipPreference } | PartnershipPreference>(
      `/api/partners/${partnershipId}/preferences`,
    ).then(unwrap<PartnershipPreference>('preferences'));
  },
  updatePreferences(partnershipId: string, patch: Partial<PartnershipPreference>) {
    return request<{ preferences: PartnershipPreference } | PartnershipPreference>(
      `/api/partners/${partnershipId}/preferences`,
      { method: 'PATCH', body: patch },
    ).then(unwrap<PartnershipPreference>('preferences'));
  },
};

// ─── Invites (unified: partner + pod) ─────────────────────────────────────
//
// All invite minting / accepting / previewing goes through /api/invites.
// Preview is unauthenticated so cold invitees can render the landing page
// before they have a session.

export type InviteKind = 'partner' | 'pod';

export interface InvitePreview {
  kind: InviteKind;
  inviterDisplayName: string;
  podName?: string;
  relationshipType?: RelationshipType;
  expiresAt: string;
}

export interface MyInvite {
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

export type CreateInviteInput =
  | { kind: 'partner'; relationshipType?: RelationshipType; displayHint?: string }
  | { kind: 'pod'; podId: string; displayHint?: string };

export type AcceptInviteResult =
  | { kind: 'partner'; partnershipId: string }
  | { kind: 'pod'; podId: string };

export const invites = {
  create(input: CreateInviteInput) {
    return request<{ token: string; expiresAt: string; kind: InviteKind }>(`/api/invites`, {
      method: 'POST',
      body: input,
    });
  },
  preview(token: string) {
    // No bearer needed — the public mount serves this without auth, so cold
    // invitees can render the landing page before any session exists.
    return request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}/preview`, {
      unauthenticated: true,
    });
  },
  accept(token: string) {
    return request<AcceptInviteResult>(`/api/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: {},
    });
  },
  revoke(token: string) {
    return request<{ ok: true }>(`/api/invites/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    });
  },
  listMine() {
    return request<{ invites: MyInvite[] }>(`/api/invites`);
  },
};

type PodWithMembers = Pod & {
  members: Array<{ personId: string; displayName: string; avatarUrl: string | null; role: string }>;
};

export const pods = {
  list() {
    return request<{ pods: Pod[] } | Pod[]>(`/api/pods`).then(unwrap<Pod[]>('pods'));
  },
  get(id: string) {
    return request<{ pod: PodWithMembers } | PodWithMembers>(`/api/pods/${id}`).then(
      unwrap<PodWithMembers>('pod'),
    );
  },
  create(input: { name: string; description?: string; emoji?: string; memberEmails?: string[] }) {
    return request<{ pod: Pod } | Pod>(`/api/pods`, { method: 'POST', body: input }).then(
      unwrap<Pod>('pod'),
    );
  },
  update(id: string, patch: Partial<Pod>) {
    return request<{ pod: Pod } | Pod>(`/api/pods/${id}`, { method: 'PATCH', body: patch }).then(
      unwrap<Pod>('pod'),
    );
  },
  getPreferences(id: string) {
    return request<{ preferences: PodPreference } | PodPreference>(
      `/api/pods/${id}/preferences`,
    ).then(unwrap<PodPreference>('preferences'));
  },
  updatePreferences(id: string, patch: Partial<PodPreference>) {
    return request<{ preferences: PodPreference } | PodPreference>(`/api/pods/${id}/preferences`, {
      method: 'PATCH',
      body: patch,
    }).then(unwrap<PodPreference>('preferences'));
  },
};

export const availability = {
  set(windows: FreeWindow[]) {
    return request<{ ok: true }>(`/api/me/availability/manual`, {
      method: 'POST',
      body: { windows },
    });
  },
  get(start: string, end: string) {
    return request<FreeWindow[]>(`/api/me/availability`, {
      query: { start, end },
    });
  },
};

export interface CalendarConnection {
  id: string;
  provider: 'google' | 'microsoft' | 'apple';
  lastSyncedAt: string | null;
  syncError: string | null;
  scopes: string[];
}

export const calendars = {
  list() {
    return request<{ connections: CalendarConnection[] }>(`/api/me/calendars`);
  },
  disconnect(id: string) {
    return request<{ ok: true }>(`/api/me/calendars/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};

export const schedule = {
  runCycle() {
    return request<{ cycleId: string }>(`/api/schedule/run`, { method: 'POST' });
  },
  proposals() {
    return request<{ proposals: TimeBlock[]; satisfaction: SatisfactionReport[] }>(
      `/api/schedule/proposals`,
    );
  },
  respond(
    blockId: string,
    response: ParticipantResponse,
    changeNote?: string,
  ) {
    return request<{ ok: true; calendarWarning?: boolean }>(
      `/api/schedule/proposals/${blockId}/respond`,
      {
        method: 'POST',
        body: { response, changeNote },
      },
    );
  },
};

// ─── AI / LLM endpoints (Phase 8) ────────────────────────────────────
//
// All endpoints degrade gracefully when ANTHROPIC_API_KEY is not configured
// on the server: every request returns 503 LLM_UNAVAILABLE. Components
// using these endpoints should hide themselves when features.get().ai is
// false (saves the round trip).

export interface ParsePreferencesProposal {
  cadence?: 'weekly' | 'biweekly' | 'monthly';
  needMinHours?: number;
  needMinDateNights?: number;
  needMinOvernights?: number;
  prefIdealHours?: number;
  prefDateNights?: number;
  prefOvernights?: number;
  prefDaytimeHangs?: number;
}

export interface ParsePreferencesResponse {
  proposed: ParsePreferencesProposal;
  currentPrefs: PartnershipPreference;
  rationale: string;
  ambiguous: boolean;
  clarifyingQuestion: string | null;
}

export interface ExplainScheduleResponse {
  explanation: string;
  suggestions: string[];
}

export interface ParseReshuffleResponse {
  blockId: string | null;
  reason: string;
  preferredAlternative: { start: string; end: string } | null;
  confidence: 'high' | 'medium' | 'low';
  clarifyingQuestion: string | null;
  candidateBlock: {
    id: string;
    eventType: string;
    partnerName: string | null;
    start: string;
    end: string;
  } | null;
}

export interface FeaturesResponse {
  ai: boolean;
  telegram: boolean;
}

export const features = {
  get() {
    return request<FeaturesResponse>(`/api/me/features`);
  },
};

export const ai = {
  parsePreferences(partnershipId: string, input: string) {
    return request<ParsePreferencesResponse>(
      `/api/partners/${partnershipId}/preferences/natural`,
      { method: 'POST', body: { input } },
    );
  },
  confirmPreferences(partnershipId: string, proposed: ParsePreferencesProposal) {
    return request<{ preferences: PartnershipPreference }>(
      `/api/partners/${partnershipId}/preferences/natural/confirm`,
      { method: 'POST', body: proposed },
    );
  },
  explainSchedule(question: string, cycleId?: string) {
    return request<ExplainScheduleResponse>(`/api/schedule/explain`, {
      method: 'POST',
      body: { question, ...(cycleId ? { cycleId } : {}) },
    });
  },
  parseReshuffle(input: string) {
    return request<ParseReshuffleResponse>(`/api/schedule/reshuffle/natural`, {
      method: 'POST',
      body: { input },
    });
  },
  confirmReshuffle(args: {
    blockId: string;
    reason: string;
    preferredAlternative?: { start: string; end: string };
  }) {
    return request<{ cycleId: string; reason: string }>(
      `/api/schedule/reshuffle/natural/confirm`,
      { method: 'POST', body: args },
    );
  },
};

// ─── New endpoints (notifications, pod chat, pod notes, pod health) ───
//
// These are consumed by the Editorial UI overhaul. All return graceful
// empty results when the server has not yet implemented the endpoint
// (404 → throws ApiError; callers/hooks treat absence as empty state).

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface PodNote {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface PodHealthMember {
  personId: string;
  displayName: string;
  avatarUrl: string | null;
  weeklyHoursWanted: number;
  weeklyHoursScheduled: number;
  satisfactionPct: number;
}

export interface PodHealth {
  members: PodHealthMember[];
  podSatisfactionPct: number;
  observations: string[];
}

export const notifications = {
  list() {
    return request<{ notifications: NotificationItem[] }>(`/api/me/notifications`);
  },
  markRead(id: string) {
    return request<{ ok: true }>(`/api/me/notifications/${id}/read`, {
      method: 'POST',
      body: {},
    });
  },
};

export const podChat = {
  list(podId: string, limit = 50) {
    return request<{ messages: ChatMessage[] }>(`/api/pods/${podId}/chat`, {
      query: { limit },
    });
  },
  send(podId: string, body: string) {
    return request<{ message: ChatMessage }>(`/api/pods/${podId}/chat`, {
      method: 'POST',
      body: { body },
    });
  },
};

export const podNotes = {
  list(podId: string) {
    return request<{ notes: PodNote[] }>(`/api/pods/${podId}/notes`);
  },
  create(podId: string, body: string) {
    return request<{ note: PodNote }>(`/api/pods/${podId}/notes`, {
      method: 'POST',
      body: { body },
    });
  },
  delete(podId: string, noteId: string) {
    return request<{ ok: true }>(`/api/pods/${podId}/notes/${noteId}`, {
      method: 'DELETE',
    });
  },
};

export const podHealth = {
  get(podId: string) {
    return request<PodHealth>(`/api/pods/${podId}/health`);
  },
};

export const api = {
  auth,
  me,
  partners,
  pods,
  availability,
  schedule,
  features,
  ai,
  notifications,
  podChat,
  podNotes,
  podHealth,
};
