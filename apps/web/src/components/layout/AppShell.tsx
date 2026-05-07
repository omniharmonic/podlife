import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Logo } from '@/components/ui/Logo';
import { auth as authApi } from '@/lib/api';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/cn';

interface AppShellProps {
  children: ReactNode;
}

const NAV = [
  { to: '/home', label: 'Home', icon: HomeIcon, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/partners', label: 'Partners', icon: HeartIcon },
  { to: '/pods', label: 'Pods', icon: PodIcon },
  { to: '/settings', label: 'Settings', icon: GearIcon },
];

export function AppShell({ children }: AppShellProps) {
  const { person, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);
  const dismissToast = useUiStore((s) => s.dismissToast);

  const handleSignOut = async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore — local logout is the source of truth */
    }
    logout();
    setMenuOpen(false);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-parchment flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-parchment/85 backdrop-blur border-b border-ink-100/50 pt-safe">
        <div className="max-w-4xl mx-auto px-5 h-16 flex items-center justify-between">
          <NavLink
            to="/home"
            className="flex items-center gap-2.5 select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ink rounded"
          >
            <Logo size={30} />
            <span className="font-display text-ink-800 text-[1.35rem] leading-none">
              Pod Life
            </span>
          </NavLink>
          {person && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:ring-offset-2"
                aria-label="Account menu"
              >
                <Avatar
                  name={person.displayName}
                  src={person.avatarUrl ?? undefined}
                  size={36}
                />
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 mt-2 w-60 bg-cream rounded-2xl shadow-letter border border-ink-100/60 z-20 overflow-hidden animate-scale-in">
                    <div className="px-5 py-3 border-b border-ink-100/60">
                      <p className="font-display text-ink-800 truncate text-[1.15rem] leading-tight">
                        {person.displayName}
                      </p>
                      <p className="text-xs text-ink-500 truncate font-mono">{person.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="w-full text-left px-5 py-2.5 text-sm hover:bg-ink-50 transition-colors"
                    >
                      Settings
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full text-left px-5 py-2.5 text-sm text-wine-600 hover:bg-wine-50 transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-4xl w-full mx-auto pb-28 sm:pb-10">{children}</main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-cream/95 backdrop-blur border-t border-ink-100/60 pb-safe">
        <div className="max-w-4xl mx-auto px-2 grid grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors relative',
                  isActive ? 'text-terracotta-600' : 'text-ink-500',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('w-5 h-5', isActive && 'scale-105')} />
                  <span className="text-[10px] tracking-[0.12em] uppercase font-medium">
                    {label}
                  </span>
                  {isActive && (
                    <span className="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-terracotta-500" aria-hidden="true" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-40 max-w-sm w-[calc(100%-2rem)] animate-fade-in"
        >
          <div
            className={cn(
              'px-4 py-3 rounded-2xl shadow-letter flex items-center gap-3 border',
              toast.tone === 'error' && 'bg-wine-500 text-cream border-wine-600',
              toast.tone === 'success' && 'bg-sage-500 text-cream border-sage-600',
              toast.tone === 'info' && 'bg-ink-800 text-cream border-ink-900',
            )}
          >
            <span className="flex-1 text-sm">{toast.message}</span>
            <button
              type="button"
              onClick={dismissToast}
              className="text-cream/80 hover:text-cream"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Icons ───

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function PodIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M3 19c1-3 4-5 9-5s8 2 9 5" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
