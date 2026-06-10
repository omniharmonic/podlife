import { create } from 'zustand';
import { getWeekStart } from '@/lib/dates';

interface UiState {
  selectedWeekStart: Date;
  toast: { id: number; message: string; tone: 'info' | 'success' | 'error' } | null;
  setSelectedWeekStart: (d: Date) => void;
  navigateWeek: (direction: 'prev' | 'next' | 'today') => void;
  showToast: (message: string, tone?: 'info' | 'success' | 'error') => void;
  dismissToast: () => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  selectedWeekStart: getWeekStart(new Date()),
  toast: null,

  setSelectedWeekStart: (d) => set({ selectedWeekStart: getWeekStart(d) }),

  navigateWeek: (direction) => {
    if (direction === 'today') {
      set({ selectedWeekStart: getWeekStart(new Date()) });
      return;
    }
    const current = get().selectedWeekStart;
    const delta = direction === 'next' ? 7 : -7;
    const next = new Date(current.getTime() + delta * 24 * 60 * 60 * 1000);
    set({ selectedWeekStart: getWeekStart(next) });
  },

  showToast: (message, tone = 'info') => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toast: { id, message, tone } });
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3500);
  },

  dismissToast: () => set({ toast: null }),
}));
