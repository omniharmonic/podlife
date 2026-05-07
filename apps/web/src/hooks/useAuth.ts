import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError, me as meApi } from '@/lib/api';

/**
 * useAuth — primary auth hook.
 * On first call, attempts to load the current person from /api/me using the
 * stored session token (if any). Sets isHydrated when finished.
 */
export function useAuth() {
  const person = useAuthStore((s) => s.person);
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrate = useAuthStore((s) => s.hydrate);
  const logout = useAuthStore((s) => s.logout);
  const login = useAuthStore((s) => s.login);
  const setPerson = useAuthStore((s) => s.setPerson);

  useEffect(() => {
    if (isHydrated) return;
    if (!sessionToken) {
      hydrate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fetched = await meApi.get();
        if (!cancelled) hydrate(fetched);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          logout();
        } else {
          // Network error — leave token in place but mark hydrated so the app can render.
          hydrate(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, isHydrated, hydrate, logout]);

  return {
    person,
    sessionToken,
    isAuthenticated: Boolean(person && sessionToken),
    isHydrated,
    login,
    logout,
    setPerson,
  };
}
