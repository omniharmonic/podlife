import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { useAuthStore } from '@/stores/auth.store';

describe('auth store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      person: null,
      sessionToken: null,
      isHydrated: false,
    });
  });

  it('login sets the session token, person, and hydrated flag', () => {
    const fakePerson = {
      id: 'p1',
      displayName: 'Alex',
      email: 'a@b.co',
      timezone: 'America/Denver',
      telegramHandle: null,
      avatarUrl: null,
      soloMinFreeEveningsPerWeek: 0,
      soloMinFreeWeekendDaysPerMonth: 0,
      notificationChannels: ['in_app' as const],
      privacyMode: false,
      onboardedAt: null,
      createdAt: new Date().toISOString(),
    };

    act(() => {
      useAuthStore.getState().login('tok-abc', fakePerson);
    });

    const state = useAuthStore.getState();
    expect(state.sessionToken).toBe('tok-abc');
    expect(state.person?.displayName).toBe('Alex');
    expect(state.isHydrated).toBe(true);
  });

  it('logout clears person and session token state', () => {
    act(() => {
      useAuthStore.getState().login('tok-xyz', {
        id: 'p1',
        displayName: 'Alex',
        email: 'a@b.co',
        timezone: 'UTC',
        telegramHandle: null,
        avatarUrl: null,
        soloMinFreeEveningsPerWeek: 0,
        soloMinFreeWeekendDaysPerMonth: 0,
        notificationChannels: [],
        privacyMode: false,
        onboardedAt: null,
        createdAt: '',
      });
    });
    expect(useAuthStore.getState().sessionToken).toBe('tok-xyz');

    act(() => {
      useAuthStore.getState().logout();
    });

    const state = useAuthStore.getState();
    expect(state.sessionToken).toBeNull();
    expect(state.person).toBeNull();
    expect(state.isHydrated).toBe(true);
  });
});
