import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PartnershipPreference,
  RelationshipType,
  SchedulingCadence,
} from '@pod-life/shared';
import { invites, partners } from '@/lib/api';

const KEYS = {
  list: ['partners'] as const,
  prefs: (id: string) => ['partners', id, 'preferences'] as const,
};

export function usePartnersList() {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: () => partners.list(),
    select: (d) => d.partners,
    // The partners list can change out-of-band — when a partner accepts an
    // invite, the inviter's client has no way to know to invalidate.
    // Always refetch on mount so /home reflects newly-accepted partners on
    // the next navigation, instead of waiting out staleTime.
    refetchOnMount: 'always',
    staleTime: 0,
  });
}

export function usePartnerPreferences(partnershipId: string | undefined) {
  return useQuery({
    queryKey: partnershipId ? KEYS.prefs(partnershipId) : ['partners', 'noop'],
    queryFn: () => partners.getPreferences(partnershipId!),
    enabled: Boolean(partnershipId),
  });
}

export function useUpdatePartnerPreferences(partnershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PartnershipPreference>) =>
      partners.updatePreferences(partnershipId, patch),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.prefs(partnershipId), data);
      qc.invalidateQueries({ queryKey: KEYS.list });
    },
  });
}

export function useInvitePartner() {
  return useMutation({
    mutationFn: (input: { relationshipType?: RelationshipType; displayHint?: string } = {}) =>
      invites.create({ kind: 'partner', ...input }),
  });
}

export function useUpdateRelationshipType(partnershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (relationshipType: RelationshipType) =>
      partners.updateRelationshipType(partnershipId, relationshipType),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

export function useProposeCadence(partnershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cadence: SchedulingCadence) =>
      partners.proposeCadence(partnershipId, cadence),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

export function useAcceptCadence(partnershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => partners.acceptCadence(partnershipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

export function useDeclineCadence(partnershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => partners.declineCadence(partnershipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

/**
 * Accept any invite (partner or pod). The hook is named after the legacy
 * partner-only flow but now branches on the result's `kind` so callers can
 * route to /partners or /pods/:id as appropriate.
 */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => invites.accept(token),
    onSuccess: (data) => {
      // Both partner and pod accepts can affect the partner list (a pod
      // accept doesn't, but invalidating is cheap and avoids stale UI).
      qc.invalidateQueries({ queryKey: KEYS.list });
      // Pod accept: invalidate pods caches by clearing the entire query
      // tree; the consumer page will refetch as needed.
      if (data.kind === 'pod') {
        qc.invalidateQueries({ queryKey: ['pods'] });
      }
    },
  });
}
