/**
 * Telegram privacy filters (P7.4) — CRITICAL.
 *
 * The core invariant (CLAUDE.md § Telegram Message Content):
 *   - DM to person P may only reference P's own partners.
 *   - Group chat for pod G may only reference members of pod G,
 *     and may NEVER reference any other pod by name.
 *
 * Implementation: substring scan against an allow-list of names.
 *
 * Limitation (documented): substring scanning is conservative — a name
 * "Sam" inside the word "sample" would not be flagged, and vice versa
 * "Al" inside "Alex" would erroneously be allowed. We use case-insensitive
 * word-boundary checks to mitigate the latter. A name appearing as part of
 * a longer unrelated word (e.g. "Sam" in "Samurai") is the residual false
 * positive — accepted because the cost of a false positive is a refused
 * message, not a privacy leak.
 */
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  partnerships,
  podMembers,
  pods,
  persons,
} from '../../db/schema.js';

export interface PrivacyValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Build a regex that matches any of the disallowed names as a whole word.
 * Word boundaries (\b) are used so we don't false-flag substrings like "Al"
 * inside "Alex" — the boundary on the right would not match.
 */
function buildDisallowedRegex(names: string[]): RegExp | null {
  const escaped = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return null;
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

export class TelegramDmPrivacyFilter {
  /**
   * Validate that an outbound DM destined for `personId` mentions only
   * names that this person has a relationship to (themselves + active partners).
   * Anyone outside that allow-list is treated as a leak.
   */
  async validate(personId: string, message: string): Promise<PrivacyValidation> {
    // Compute the universe of allowed names.
    const me = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
    if (!me[0]) return { ok: false, reason: 'unknown person' };

    const myPartnerships = await db
      .select()
      .from(partnerships)
      .where(
        and(
          or(eq(partnerships.personAId, personId), eq(partnerships.personBId, personId)),
          eq(partnerships.status, 'active'),
        ),
      );
    const partnerIds = myPartnerships.map((p) =>
      p.personAId === personId ? p.personBId : p.personAId,
    );
    const partnerRows = partnerIds.length
      ? await db.select().from(persons).where(inArray(persons.id, partnerIds))
      : [];
    const allowedNames = new Set<string>([me[0].displayName, ...partnerRows.map((p) => p.displayName)]);

    // Compute the set of disallowed names: every other person in the system
    // is potentially leaky, but practically we only need to check names that
    // the API server might have inserted into a message. We narrow that to:
    //   - all members of pods this person is in (to catch cross-pod V-structures
    //     where a pod includes their partner-of-partner)
    //   - … but exclude any name in `allowedNames`.
    // For tests + correctness we simply scan against ALL persons not in the
    // allow-list. This is O(N) but N is the user count of one server — fine.
    const all = await db.select().from(persons);
    const disallowed = all
      .filter((p) => !allowedNames.has(p.displayName) && p.id !== personId)
      .map((p) => p.displayName);

    const re = buildDisallowedRegex(disallowed);
    if (!re) return { ok: true };
    const m = re.exec(message);
    if (m) {
      return { ok: false, reason: `disallowed name: ${m[1]}` };
    }
    return { ok: true };
  }
}

export class TelegramGroupPrivacyFilter {
  /**
   * Validate that an outbound group-chat message destined for `podId` only
   * references this pod's members and does not name any other pod.
   */
  async validate(podId: string, message: string): Promise<PrivacyValidation> {
    const allMembers = await db
      .select({ personId: podMembers.personId, podId: podMembers.podId })
      .from(podMembers)
      .where(isNotNull(podMembers.joinedAt));
    const myMemberIds = new Set(
      allMembers.filter((m) => m.podId === podId).map((m) => m.personId),
    );

    const allPersons = await db.select().from(persons);
    const personById = new Map(allPersons.map((p) => [p.id, p]));

    const allowedPersonNames = new Set<string>(
      Array.from(myMemberIds)
        .map((id) => personById.get(id)?.displayName)
        .filter((n): n is string => !!n),
    );
    const disallowedPersonNames = allPersons
      .filter((p) => !allowedPersonNames.has(p.displayName))
      .map((p) => p.displayName);

    const allPods = await db.select().from(pods);
    const otherPodNames = allPods.filter((p) => p.id !== podId).map((p) => p.name);

    // Combined disallow regex.
    const re = buildDisallowedRegex([...disallowedPersonNames, ...otherPodNames]);
    if (!re) return { ok: true };
    const m = re.exec(message);
    if (m) {
      return { ok: false, reason: `disallowed name: ${m[1]}` };
    }
    return { ok: true };
  }
}

export const dmPrivacyFilter = new TelegramDmPrivacyFilter();
export const groupPrivacyFilter = new TelegramGroupPrivacyFilter();
