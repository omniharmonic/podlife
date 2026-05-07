/**
 * Feature-flag hook. Reads /api/me/features once per session and caches
 * the result. Components should hide AI/Telegram-specific UI when their
 * flag is false.
 */
import { useQuery } from '@tanstack/react-query';
import { features as featuresApi } from '@/lib/api';

export function useFeatures() {
  return useQuery({
    queryKey: ['features'],
    queryFn: () => featuresApi.get(),
    // Features are server-config; safe to cache aggressively.
    staleTime: 5 * 60 * 1000,
  });
}
