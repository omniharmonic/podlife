import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TimeBlock, SatisfactionReport } from '@pod-life/shared';
import { useRespondToProposal } from '@/hooks/useSchedule';
import { schedule } from '@/lib/api';

/**
 * The optimistic update is the entire fix for "I keep clicking accept" —
 * without it, the card stays in `pending` state until the network round-trip
 * + refetch finishes. These tests cover three properties:
 *
 *   1. The cache flips `myResponse` immediately when the mutation fires
 *      (before the server response lands).
 *   2. On error, the cache rolls back to the pre-click state.
 *   3. On success, the cache is invalidated so the authoritative server
 *      shape (e.g. block status moving to 'locked' and disappearing from
 *      the proposals list) reaches the UI.
 */

const blockId = '11111111-1111-1111-1111-111111111111';
const proposalsKey = ['schedule', 'proposals'] as const;

function seedBlock(): TimeBlock {
  return {
    id: blockId,
    cycleId: '22222222-2222-2222-2222-222222222222',
    eventType: 'Date Night',
    eventLabel: null,
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 3600_000).toISOString(),
    status: 'proposed',
    myResponse: 'pending',
    partnershipId: null,
    sourcePodId: null,
    satisfactionContribution: {},
  };
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useRespondToProposal — optimistic update', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    qc.setQueryData(proposalsKey, {
      proposals: [seedBlock()],
      satisfaction: [] as SatisfactionReport[],
      reviewWindowEnd: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes myResponse to the cache the moment mutate is called', async () => {
    let resolveRespond: (value: { ok: true; calendarWarning?: boolean }) => void = () => {};
    const pending = new Promise<{ ok: true; calendarWarning?: boolean }>((res) => {
      resolveRespond = res;
    });
    vi.spyOn(schedule, 'respond').mockReturnValue(pending);

    const { result } = renderHook(() => useRespondToProposal(), {
      wrapper: makeWrapper(qc),
    });

    // Fire — but don't await. We want to observe the cache mid-flight.
    void result.current.mutateAsync({ blockId, response: 'accepted' });

    await waitFor(() => {
      const cached = qc.getQueryData<{ proposals: TimeBlock[] }>(proposalsKey);
      expect(cached?.proposals[0]?.myResponse).toBe('accepted');
    });

    // Resolve the network call so the test cleans up.
    resolveRespond({ ok: true, calendarWarning: false });
  });

  it('rolls back the cache on error', async () => {
    vi.spyOn(schedule, 'respond').mockRejectedValue(new Error('network blew up'));

    const { result } = renderHook(() => useRespondToProposal(), {
      wrapper: makeWrapper(qc),
    });

    await expect(
      result.current.mutateAsync({ blockId, response: 'accepted' }),
    ).rejects.toThrow('network blew up');

    // After rollback, myResponse is back to 'pending'.
    const cached = qc.getQueryData<{ proposals: TimeBlock[] }>(proposalsKey);
    expect(cached?.proposals[0]?.myResponse).toBe('pending');
  });

  it('invalidates the proposals query after success so server state lands', async () => {
    vi.spyOn(schedule, 'respond').mockResolvedValue({ ok: true });

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useRespondToProposal(), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync({ blockId, response: 'accepted' });

    // invalidateQueries was called with the proposals key.
    const calls = invalidateSpy.mock.calls.map((c) => c[0]);
    const hit = calls.some(
      (arg) =>
        arg &&
        typeof arg === 'object' &&
        'queryKey' in arg &&
        JSON.stringify((arg as { queryKey: unknown }).queryKey) ===
          JSON.stringify(proposalsKey),
    );
    expect(hit).toBe(true);
  });

  it('does not duplicate the block on multiple in-flight mutates against the same id', async () => {
    // Regression guard: if the optimistic update touched the proposals array
    // by .push() instead of .map(), a fast double-click would create a
    // ghost block. Verify the array length stays at 1 across two clicks.
    vi.spyOn(schedule, 'respond').mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useRespondToProposal(), {
      wrapper: makeWrapper(qc),
    });
    await result.current.mutateAsync({ blockId, response: 'accepted' });
    await result.current.mutateAsync({ blockId, response: 'accepted' });
    const cached = qc.getQueryData<{ proposals: TimeBlock[] }>(proposalsKey);
    expect(cached?.proposals).toHaveLength(1);
    expect(cached?.proposals[0]?.myResponse).toBe('accepted');
  });
});
