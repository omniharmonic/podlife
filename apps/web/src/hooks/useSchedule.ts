import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ParticipantResponse, TimeBlock, SatisfactionReport } from '@pod-life/shared';
import { schedule } from '@/lib/api';

const KEYS = {
  proposals: ['schedule', 'proposals'] as const,
};

type ProposalsResponse = {
  proposals: TimeBlock[];
  satisfaction: SatisfactionReport[];
  reviewWindowEnd?: string | null;
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

/**
 * Accept / decline a proposed block.
 *
 * We optimistically write the new `myResponse` into the cached proposals so
 * the UI flips to "Accepted by you" the instant the click lands — without
 * waiting for the network round-trip + refetch. The button's hard-disable
 * (in ProposalCard) reads from this same cached state, so a double-click
 * can't fire a duplicate mutation against the same block.
 *
 * onError rolls back the optimistic write. onSettled invalidates so the
 * authoritative server state lands (including block.status changes — e.g.
 * the last accept may have moved it from `proposed` to `accepted`/`locked`,
 * which drops it from the proposals list entirely).
 */
export function useRespondToProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      blockId: string;
      response: ParticipantResponse;
      changeNote?: string;
    }) => schedule.respond(input.blockId, input.response, input.changeNote),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: KEYS.proposals });
      const prev = qc.getQueryData<ProposalsResponse>(KEYS.proposals);
      if (prev) {
        qc.setQueryData<ProposalsResponse>(KEYS.proposals, {
          ...prev,
          proposals: prev.proposals.map((b) =>
            b.id === input.blockId ? { ...b, myResponse: input.response } : b,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEYS.proposals, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.proposals }),
  });
}
