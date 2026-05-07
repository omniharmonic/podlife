import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnershipPreference } from '@pod-life/shared';
import { partners } from '@/lib/api';

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
    mutationFn: () => partners.invite(),
  });
}

export function useAcceptPartnerInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => partners.accept(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}
