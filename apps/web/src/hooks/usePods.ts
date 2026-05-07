import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Pod, PodPreference } from '@pod-life/shared';
import { pods } from '@/lib/api';

const KEYS = {
  list: ['pods'] as const,
  detail: (id: string) => ['pods', id] as const,
  prefs: (id: string) => ['pods', id, 'preferences'] as const,
};

export function usePodsList() {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: () => pods.list(),
  });
}

export function usePod(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detail(id) : ['pods', 'noop'],
    queryFn: () => pods.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreatePod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      description?: string;
      emoji?: string;
      memberEmails?: string[];
    }) => pods.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

export function usePodPreferences(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.prefs(id) : ['pods', 'noop'],
    queryFn: () => pods.getPreferences(id!),
    enabled: Boolean(id),
  });
}

export function useUpdatePodPreferences(podId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PodPreference>) => pods.updatePreferences(podId, patch),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.prefs(podId), data);
    },
  });
}

export function useUpdatePod(podId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pod>) => pods.update(podId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.detail(podId) });
      qc.invalidateQueries({ queryKey: KEYS.list });
    },
  });
}
