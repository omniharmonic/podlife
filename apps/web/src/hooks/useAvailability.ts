import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FreeWindow } from '@pod-life/shared';
import { availability } from '@/lib/api';

const KEYS = {
  range: (start: string, end: string) =>
    ['availability', start, end] as const,
};

export function useAvailability(start: string | undefined, end: string | undefined) {
  return useQuery({
    queryKey: start && end ? KEYS.range(start, end) : ['availability', 'noop'],
    queryFn: () => availability.get(start!, end!),
    enabled: Boolean(start && end),
  });
}

export function useSetManualAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (windows: FreeWindow[]) => availability.set(windows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}
