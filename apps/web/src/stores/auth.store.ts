import { create } from 'zustand';
import type { Person } from '@pod-life/shared';
import { getSessionToken, setSessionToken } from '@/lib/api';

interface AuthState {
  person: Person | null;
  sessionToken: string | null;
  isHydrated: boolean;
  login: (token: string, person: Person) => void;
  logout: () => void;
  setPerson: (person: Person) => void;
  /** Mark hydration finished (called after first /api/me check). */
  hydrate: (person: Person | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  person: null,
  sessionToken: getSessionToken(),
  isHydrated: false,

  login: (token, person) => {
    setSessionToken(token);
    set({ sessionToken: token, person, isHydrated: true });
  },

  logout: () => {
    setSessionToken(null);
    set({ sessionToken: null, person: null, isHydrated: true });
  },

  setPerson: (person) => set({ person }),

  hydrate: (person) => set({ person, isHydrated: true }),
}));
