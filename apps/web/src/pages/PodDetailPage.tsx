import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { parseISO, isSameDay, formatDistanceToNow } from 'date-fns';
import type { SchedulingCadence } from '@pod-life/shared';
import { usePod, useUpdatePod } from '@/hooks/usePods';
import { useProposals } from '@/hooks/useSchedule';
import {
  usePodHealth,
  usePodChat,
  useSendChatMessage,
} from '@/hooks/usePodExtras';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';
import { useUiStore } from '@/stores/ui.store';
import { useAuth } from '@/hooks/useAuth';
import {
  format,
  formatTimeRange,
  getWeekDays,
  getWeekStart,
} from '@/lib/dates';

const CADENCE_OPTIONS: { value: SchedulingCadence; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export function PodDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { person } = useAuth();
  const pod = usePod(id);
  const updatePod = useUpdatePod(id);
  const proposals = useProposals();
  const health = usePodHealth(id);
  const chat = usePodChat(id);
  const sendChat = useSendChatMessage(id);
  const showToast = useUiStore((s) => s.showToast);

  const [chatDraft, setChatDraft] = useState('');
  const [editingCycle, setEditingCycle] = useState(false);

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    try {
      await sendChat.mutateAsync(chatDraft.trim());
      setChatDraft('');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not send message',
        'error',
      );
    }
  }

  const weekStart = getWeekStart(new Date());
  const weekDays = getWeekDays(weekStart);
  const blocks = proposals.data?.proposals ?? [];

  const messages = chat.data?.messages ?? [];
  const members = pod.data?.members ?? [];
  const memberByPersonId = useMemo(() => {
    const m = new Map<string, { displayName: string }>();
    for (const mem of members) m.set(mem.personId, { displayName: mem.displayName });
    return m;
  }, [members]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-8"
    >
      <Link
        to="/pods"
        className="text-xs uppercase tracking-[0.16em] text-ink-500 hover:text-ink-800 inline-flex items-center gap-1 font-medium"
      >
        ← All pods
      </Link>

      {/* Header: pod identity + member avatars */}
      {pod.data && (
        <header className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <span
                className="text-4xl shrink-0"
                aria-hidden="true"
                style={{ filter: 'saturate(0.9)' }}
              >
                {pod.data.emoji ?? '🏠'}
              </span>
              <div className="min-w-0">
                <p className="eyebrow mb-1.5">Pod</p>
                <h1 className="font-display text-ink-800 text-[2.4rem] sm:text-[3rem] leading-[1.04] tracking-[-0.005em]">
                  {pod.data.name}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {members.map((m) => {
              const isMe = m.personId === person?.id;
              return (
                <div
                  key={m.personId}
                  className="flex items-center gap-2 bg-cream border border-ink-100/60 rounded-full pl-1 pr-3 py-1"
                >
                  <Avatar name={m.displayName} size={26} />
                  <span className="text-[13px] text-ink-700 font-medium">
                    {isMe ? 'You' : m.displayName.split(/\s+/)[0]}
                  </span>
                  {m.role === 'admin' && (
                    <span className="text-[9px] uppercase tracking-[0.14em] text-ink-400 font-medium">
                      admin
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </header>
      )}

      {/* Cycle controls — visible, editable in place */}
      {pod.data && (
        <Card padding="md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow mb-2">Scheduling cycle</p>
              {!editingCycle ? (
                <>
                  <p className="font-display text-ink-800 text-2xl leading-tight">
                    {cadenceLabel(pod.data.schedulingCadence)} ·{' '}
                    {dayName(pod.data.cycleDayOfWeek)}s
                  </p>
                  <p className="text-sm text-ink-500 mt-1">
                    Each cycle drafts a new schedule, leaving you{' '}
                    <span className="text-ink-700 font-medium">
                      {pod.data.reviewWindowHours}h
                    </span>{' '}
                    to review.
                  </p>
                </>
              ) : (
                <CycleEditor
                  cadence={pod.data.schedulingCadence}
                  cycleDayOfWeek={pod.data.cycleDayOfWeek}
                  reviewWindowHours={pod.data.reviewWindowHours}
                  onCancel={() => setEditingCycle(false)}
                  saving={updatePod.isPending}
                  onSave={async (patch) => {
                    try {
                      await updatePod.mutateAsync(patch);
                      showToast('Cycle updated', 'success');
                      setEditingCycle(false);
                    } catch (err) {
                      showToast(
                        err instanceof Error ? err.message : 'Could not update',
                        'error',
                      );
                    }
                  }}
                />
              )}
            </div>
            {!editingCycle && (
              <Button size="sm" variant="ghost" onClick={() => setEditingCycle(true)}>
                Edit
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Pod health */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-ink-800 text-2xl">Pod health</h2>
          <span className="text-xs text-ink-500">This cycle</span>
        </div>
        {health.isLoading ? (
          <Card padding="md">
            <p className="text-sm text-ink-500">Listening for the pulse…</p>
          </Card>
        ) : (health.data?.members?.length ?? 0) === 0 ? (
          <Card as="dashed" padding="md">
            <p className="text-sm text-ink-500">
              Health metrics will appear here once a cycle has run.
            </p>
          </Card>
        ) : (
          <Card padding="md">
            <div className="flex flex-wrap items-center gap-7 sm:gap-10">
              <div className="flex flex-col items-center">
                <SatisfactionRing
                  pct={(health.data?.podSatisfactionPct ?? 0) * 100}
                  size={104}
                  strokeWidth={3}
                />
                <span className="meta-mono mt-2">Pod overall</span>
              </div>
              <div className="h-20 w-px bg-ink-100/80 hidden sm:block" aria-hidden="true" />
              <div className="flex flex-wrap gap-5">
                {(health.data?.members ?? []).map((m) => (
                  <SatisfactionRing
                    key={m.personId}
                    pct={m.satisfactionPct * 100}
                    size={62}
                    label={m.displayName.split(/\s+/)[0]}
                  />
                ))}
              </div>
            </div>

            {(health.data?.observations ?? []).length > 0 && (
              <div className="mt-7 pt-5 border-t border-ink-100/70 flex flex-col gap-1.5">
                {(health.data?.observations ?? []).map((obs, i) => (
                  <p key={i} className="text-[15px] text-ink-700 leading-relaxed">
                    {obs}
                  </p>
                ))}
              </div>
            )}

            {/* Wanted vs scheduled */}
            <div className="mt-7 pt-5 border-t border-ink-100/70 flex flex-col gap-3.5">
              {(health.data?.members ?? []).map((m) => {
                const wanted = m.weeklyHoursWanted;
                const scheduled = m.weeklyHoursScheduled;
                const max = Math.max(wanted, scheduled, 1);
                return (
                  <div
                    key={m.personId}
                    className="grid grid-cols-[88px_1fr_auto] sm:grid-cols-[120px_1fr_auto] items-center gap-3"
                  >
                    <span className="text-sm text-ink-700 truncate font-medium">
                      {m.displayName.split(/\s+/)[0]}
                    </span>
                    <div className="relative h-[10px] rounded-full bg-ink-100/70 overflow-hidden">
                      <div
                        className="absolute left-0 top-0 h-full bg-ink-300/70"
                        style={{ width: `${(wanted / max) * 100}%` }}
                        title={`Wanted ${wanted}h`}
                      />
                      <div
                        className="absolute left-0 top-0 h-full bg-terracotta-500"
                        style={{ width: `${(scheduled / max) * 100}%` }}
                        title={`Scheduled ${scheduled}h`}
                      />
                    </div>
                    <span className="text-xs text-ink-500 tabular-nums whitespace-nowrap">
                      {scheduled}h <span className="text-ink-300">/ {wanted}h</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </section>

      {/* Week at a glance */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-ink-800 text-2xl">This week</h2>
          <Link
            to="/calendar"
            className="text-xs uppercase tracking-[0.16em] font-medium text-terracotta-600 hover:underline"
          >
            Open calendar →
          </Link>
        </div>
        <Card padding="sm">
          <div className="grid grid-cols-7 gap-1.5">
            {weekDays.map((day) => {
              const dayBlocks = blocks.filter((b) =>
                isSameDay(parseISO(b.startTime), day),
              );
              const isToday = isSameDay(day, new Date());
              return (
                <div key={day.toISOString()} className="flex flex-col gap-1">
                  <div
                    className={`text-center pb-1.5 border-b ${isToday ? 'border-terracotta-500' : 'border-ink-100/60'}`}
                  >
                    <span className="block text-[10px] uppercase tracking-[0.14em] text-ink-500 font-medium">
                      {format(day, 'EEE')}
                    </span>
                    <span
                      className={`font-display text-base ${isToday ? 'text-terracotta-600' : 'text-ink-800'}`}
                    >
                      {format(day, 'd')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 min-h-[44px]">
                    {dayBlocks.length === 0 ? (
                      <span className="text-[10px] text-ink-300 text-center pt-1.5">
                        ·
                      </span>
                    ) : (
                      dayBlocks.slice(0, 3).map((b) => (
                        <span
                          key={b.id}
                          className="text-[9.5px] text-ink-700 truncate px-1.5 py-0.5 rounded bg-ink-50 tabular-nums"
                          title={`${b.eventLabel ?? b.eventType} ${formatTimeRange(parseISO(b.startTime), parseISO(b.endTime))}`}
                        >
                          {format(parseISO(b.startTime), 'h:mma').toLowerCase()}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Conversation — single thread, no notes/chat split */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-ink-800 text-2xl">Conversation</h2>
          {messages.length > 0 && (
            <span className="text-xs text-ink-500">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <form
          onSubmit={handleSendChat}
          className="bg-cream border border-ink-100/60 rounded-2xl p-3 flex flex-col gap-2 shadow-paper"
        >
          <textarea
            value={chatDraft}
            onChange={(e) => setChatDraft(e.currentTarget.value)}
            placeholder={`Write to the pod${pod.data?.name ? `, ${pod.data.name}` : ''}…`}
            className="w-full min-h-[60px] bg-transparent px-2 py-1 text-[15px] text-ink-800 placeholder:text-ink-400 focus:outline-none resize-none"
            maxLength={4000}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              loading={sendChat.isPending}
              disabled={!chatDraft.trim()}
            >
              Send
            </Button>
          </div>
        </form>

        {messages.length === 0 ? (
          <Card as="dashed" padding="md">
            <p className="text-sm text-ink-500">
              {chat.isLoading ? 'Listening…' : 'No messages yet. Start the thread.'}
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => {
              const isMe = m.authorId === person?.id;
              const member = memberByPersonId.get(m.authorId);
              const displayName = member?.displayName ?? m.authorName;
              return (
                <li
                  key={m.id}
                  className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}
                >
                  <Avatar name={displayName} size={32} />
                  <div className={`max-w-[80%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-medium text-ink-800">
                        {isMe ? 'You' : displayName.split(/\s+/)[0]}
                      </span>
                      <span className="text-[10px] text-ink-400">
                        {formatDistanceToNow(parseISO(m.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <div
                      className={`px-3.5 py-2 rounded-2xl text-[15px] leading-relaxed whitespace-pre-wrap ${
                        isMe
                          ? 'bg-terracotta-500 text-cream rounded-tr-sm'
                          : 'bg-cream border border-ink-100/60 text-ink-800 rounded-tl-sm'
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </motion.div>
  );
}

function cadenceLabel(c: SchedulingCadence): string {
  switch (c) {
    case 'weekly':
      return 'Weekly';
    case 'biweekly':
      return 'Every 2 weeks';
    case 'monthly':
      return 'Monthly';
  }
}

function dayName(n: number): string {
  return DAY_OPTIONS[n]?.label ?? '—';
}

interface CycleEditorProps {
  cadence: SchedulingCadence;
  cycleDayOfWeek: number;
  reviewWindowHours: number;
  onSave: (patch: {
    schedulingCadence: SchedulingCadence;
    cycleDayOfWeek: number;
    reviewWindowHours: number;
  }) => Promise<void> | void;
  onCancel: () => void;
  saving: boolean;
}

function CycleEditor({
  cadence,
  cycleDayOfWeek,
  reviewWindowHours,
  onSave,
  onCancel,
  saving,
}: CycleEditorProps) {
  const [c, setC] = useState<SchedulingCadence>(cadence);
  const [d, setD] = useState(cycleDayOfWeek);
  const [r, setR] = useState(reviewWindowHours);

  return (
    <div className="flex flex-col gap-3 mt-1">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Select
          label="Cadence"
          value={c}
          onChange={(e) => setC(e.currentTarget.value as SchedulingCadence)}
        >
          {CADENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          label="Cycle starts"
          value={d}
          onChange={(e) => setD(Number(e.currentTarget.value))}
        >
          {DAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          label="Review window (hours)"
          value={r}
          onChange={(e) => setR(Number(e.currentTarget.value))}
        >
          {[12, 24, 36, 48, 72].map((n) => (
            <option key={n} value={n}>
              {n}h
            </option>
          ))}
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          loading={saving}
          onClick={() =>
            onSave({
              schedulingCadence: c,
              cycleDayOfWeek: d,
              reviewWindowHours: r,
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
