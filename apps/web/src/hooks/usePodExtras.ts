import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notifications as notifApi,
  podChat as chatApi,
  podNotes as notesApi,
  podHealth as healthApi,
  ApiError,
  type NotificationItem,
  type ChatMessage,
  type PodNote,
  type PodHealth,
} from '@/lib/api';

/**
 * Hooks for the new endpoints introduced by the Editorial UI overhaul:
 *   notifications, pod chat, pod notes, pod health.
 *
 * If the backend hasn't implemented a given endpoint yet (404), the hook
 * returns an empty array / null instead of an error so the UI can render a
 * graceful empty state.
 */

function softFallback<T>(fallback: T) {
  return async (fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        return fallback;
      }
      throw err;
    }
  };
}

// ─── Notifications ───

const NOTIF_KEY = ['notifications'] as const;

export function useNotifications() {
  return useQuery({
    queryKey: NOTIF_KEY,
    queryFn: () =>
      softFallback<{ notifications: NotificationItem[] }>({ notifications: [] })(() =>
        notifApi.list(),
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notifApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIF_KEY }),
  });
}

// ─── Pod chat ───

const chatKey = (podId: string) => ['pods', podId, 'chat'] as const;

export function usePodChat(podId: string | undefined) {
  return useQuery({
    queryKey: podId ? chatKey(podId) : ['pods', 'noop', 'chat'],
    queryFn: () =>
      softFallback<{ messages: ChatMessage[] }>({ messages: [] })(() =>
        chatApi.list(podId!, 50),
      ),
    enabled: Boolean(podId),
    refetchInterval: 30_000,
  });
}

export function useSendChatMessage(podId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => chatApi.send(podId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey(podId) }),
  });
}

// ─── Pod notes ───

const notesKey = (podId: string) => ['pods', podId, 'notes'] as const;

export function usePodNotes(podId: string | undefined) {
  return useQuery({
    queryKey: podId ? notesKey(podId) : ['pods', 'noop', 'notes'],
    queryFn: () =>
      softFallback<{ notes: PodNote[] }>({ notes: [] })(() => notesApi.list(podId!)),
    enabled: Boolean(podId),
  });
}

export function useCreatePodNote(podId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => notesApi.create(podId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(podId) }),
  });
}

export function useDeletePodNote(podId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => notesApi.delete(podId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(podId) }),
  });
}

// ─── Pod health ───

export function usePodHealth(podId: string | undefined) {
  return useQuery({
    queryKey: podId ? ['pods', podId, 'health'] : ['pods', 'noop', 'health'],
    queryFn: () =>
      softFallback<PodHealth>({
        members: [],
        podSatisfactionPct: 0,
        observations: [],
      })(() => healthApi.get(podId!)),
    enabled: Boolean(podId),
  });
}
