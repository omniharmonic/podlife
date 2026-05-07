import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface RequireAuthProps {
  children: ReactNode;
  /** When true, also redirect first-time users to /onboarding. */
  requireOnboarded?: boolean;
}

const ONBOARDED_KEY = 'podlife.onboarded';

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-parchment">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-terracotta-200 border-t-terracotta-500 rounded-full animate-spin" />
        <p className="text-sm text-ink-500 italic">Loading…</p>
      </div>
    </div>
  );
}

function isOnboarded(person: { onboardedAt?: string | null } | null): boolean {
  if (person?.onboardedAt) return true;
  try {
    return localStorage.getItem(ONBOARDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function RequireAuth({ children, requireOnboarded = true }: RequireAuthProps) {
  const { isAuthenticated, isHydrated, person } = useAuth();
  const location = useLocation();

  if (!isHydrated) return <FullPageLoader />;

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (requireOnboarded && person && !isOnboarded(person)) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
