/**
 * Internal optimizer types — not exported through the API contract.
 *
 * The wire contract is in @pod-life/shared (OptimizationRequest etc.).
 * These types describe the in-memory shape we pass between slot-discovery
 * and the solver.
 */
import type { OptimizationRequest } from '@pod-life/shared';

/**
 * A potential time block the solver may select.
 *
 * `participantKey` is a stable canonical key for a set of participants —
 * the equivalent of Python's `frozenset(participant_ids)`. It is the
 * sorted, pipe-joined ids; e.g. ["B", "A"] → "A|B". Use this for set
 * equality across candidates.
 */
export interface CandidateSlot {
  /** Inclusive index into the discretized horizon. */
  startSlot: number;
  /** Exclusive end-slot index. */
  endSlot: number;
  durationHours: number;
  /** Participant ids — order is not significant. */
  participantIds: string[];
  /** Sorted-pipe-joined participant key (set semantics). */
  participantKey: string;
  eventType: string;
  partnershipId: string | null;
  podId: string | null;
}

/**
 * Parsed/normalized request — Date objects instead of ISO strings, and
 * with `slot_duration_minutes` defaulted. Constructed once at the top
 * of solve() so downstream code doesn't re-parse.
 */
export interface PreparedRequest {
  raw: OptimizationRequest;
  horizonStart: Date;
  horizonEnd: Date;
  horizonSlots: number;
  horizonSeconds: number;
  slotMinutes: number;
}

/** Build the canonical participant set key. Sorted + pipe-joined. */
export function participantKeyOf(ids: readonly string[]): string {
  return [...ids].sort().join('|');
}
