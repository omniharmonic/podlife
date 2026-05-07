import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ParticipantResponse } from '@pod-life/shared';
import { schedule } from '@/lib/api';

const KEYS = {
  proposals: ['schedule', 'proposals'] as const,
};

export function useProposals() {
  return useQuery({
    queryKey: KEYS.proposals,
    queryFn: () => schedule.proposals(),
    refetchInterval: 60_000,
  });
}

export function useRunCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => schedule.runCycle(),
    onSuccess: () => {
      // The cycle is async (BullMQ + optimizer): the POST returns a cycleId
      // immediately but proposals only land after the worker finishes. Poll a
      // few times so the calendar refreshes without a manual reload.
      qc.invalidateQueries({ queryKey: KEYS.proposals });
      const delays = [1500, 3000, 6000];
      for (const ms of delays) {
        setTimeout(() => qc.invalidateQueries({ queryKey: KEYS.proposals }), ms);
      }
    },
  });
}

export function useRespondToProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      blockId: string;
      response: ParticipantResponse;
      changeNote?: string;
    }) => schedule.respond(input.blockId, input.response, input.changeNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.proposals }),
  });
}
