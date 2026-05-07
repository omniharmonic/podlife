import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PartnerSummary, TimeBlock } from '@pod-life/shared';
import { useProposals, useRespondToProposal } from '@/hooks/useSchedule';
import { usePartnersList } from '@/hooks/usePartners';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUiStore } from '@/stores/ui.store';
import { ExplainScheduleButton } from '@/components/ai/ExplainScheduleButton';
import { NaturalReshuffleInput } from '@/components/ai/NaturalReshuffleInput';
import {
  formatDayShort,
  formatTimeRange,
  parseISO,
  durationMinutes,
  formatDuration,
} from '@/lib/dates';

type ViewerState = 'pending' | 'accepted' | 'declined';

function viewerState(block: TimeBlock): ViewerState {
  if (block.myResponse === 'accepted') return 'accepted';
  if (block.myResponse === 'declined') return 'declined';
  return 'pending';
}

export function ProposalReviewPage() {
  const { person } = useAuth();
  const proposals = useProposals();
  const partners = usePartnersList();
  const respond = useRespondToProposal();
  const showToast = useUiStore((s) => s.showToast);
  const [bulkPending, setBulkPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const all = useMemo(() => proposals.data?.proposals ?? [], [proposals.data]);
  const pending = useMemo(
    () => all.filter((b) => viewerState(b) === 'pending'),
    [all],
  );
  const acceptedByMe = useMemo(
    () => all.filter((b) => viewerState(b) === 'accepted'),
    [all],
  );
  const declinedByMe = useMemo(
    () => all.filter((b) => viewerState(b) === 'declined'),
    [all],
  );

  const partnerByPartnership = useMemo(() => {
    const map = new Map<string, PartnerSummary>();
    for (const p of partners.data ?? []) map.set(p.partnershipId, p);
    return map;
  }, [partners.data]);

  const mySat = useMemo(() => {
    if (!person) return null;
    return (
      proposals.data?.satisfaction?.find((s) => s.person_id === person.id) ?? null
    );
  }, [proposals.data, person]);

  const reviewDeadline = useMemo<number | null>(() => {
    if (pending.length === 0) return null;
    return now + 24 * 60 * 60 * 1000;
  }, [pending.length, now]);

  const remaining = reviewDeadline ? Math.max(0, reviewDeadline - now) : 0;

  async function acceptAll() {
    if (pending.length === 0) return;
    setBulkPending(true);
    try {
      await Promise.all(
        pending.map((b) =>
          respond.mutateAsync({ blockId: b.id, response: 'accepted' }),
        ),
      );
      showToast(`Accepted ${pending.length} block${pending.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Some responses failed — please retry',
        'error',
      );
    } finally {
      setBulkPending(false);
    }
  }

  function getColor(partnershipId: string | null): string {
    if (!partnershipId) return '#7A9A85';
    return partnerByPartnership.get(partnershipId)?.color ?? '#7A9A85';
  }

  function getPartnerName(partnershipId: string | null): string | undefined {
    if (!partnershipId) return undefined;
    return partnerByPartnership.get(partnershipId)?.partner.displayName;
  }

  const allDone = all.length > 0 && pending.length === 0;

  return (
    <div className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-7">
      <Link
        to="/calendar"
        className="text-xs uppercase tracking-[0.16em] text-ink-500 hover:text-ink-800 inline-flex items-center gap-1 font-medium"
      >
        ← Back to calendar
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Schedule review</p>
          <h1 className="font-display text-ink-800 text-[2.5rem] sm:text-[3rem] leading-[1.05]">
            {pending.length === 0
              ? all.length === 0
                ? 'No proposals to review'
                : 'You\'re all set'
              : `${pending.length} to review`}
          </h1>
          <p className="text-sm text-ink-500 mt-2">
            {pending.length > 0 && reviewDeadline
              ? remaining > 0
                ? `Closes in ${formatCountdown(remaining)}`
                : 'Review window closed'
              : allDone
                ? 'Waiting on your pod and partners.'
                : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExplainScheduleButton size="sm" />
          {mySat && (
            <SatisfactionRing pct={mySat.overall_pct * 100} size={64} label="for you" />
          )}
        </div>
      </header>

      {/* Satisfaction summary */}
      {mySat && Object.keys(mySat.per_partner).length > 0 && (
        <Card>
          <h3 className="eyebrow mb-3">How this schedule lands</h3>
          <div className="flex flex-wrap gap-5">
            {Object.entries(mySat.per_partner).map(([partnerId, stats]) => {
              const partner = (partners.data ?? []).find(
                (p) => p.partner.id === partnerId,
              );
              return (
                <div key={partnerId} className="flex flex-col items-center gap-1">
                  <SatisfactionRing
                    pct={(stats.pref_pct ?? 0) * 100}
                    color={partner?.color}
                    size={56}
                    label={partner?.partner.displayName ?? 'Partner'}
                  />
                  {!stats.need_met && (
                    <span className="text-[10px] uppercase tracking-[0.14em] text-wine-600 font-medium">
                      below need
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {proposals.isLoading ? (
        <Card>
          <div className="text-ink-500 text-sm">Loading proposals…</div>
        </Card>
      ) : all.length === 0 ? (
        <EmptyState
          title="No proposals to review"
          description="When the optimizer suggests a new schedule, you'll see each block here for review."
        />
      ) : (
        <>
          {pending.length > 0 && (
            <ProposalGroup
              label="To review"
              count={pending.length}
              tone="pending"
            >
              {pending.map((block) => (
                <ProposalRow
                  key={block.id}
                  block={block}
                  state="pending"
                  partnerName={getPartnerName(block.partnershipId)}
                  color={getColor(block.partnershipId)}
                  onAccept={() =>
                    respond
                      .mutateAsync({ blockId: block.id, response: 'accepted' })
                      .then(() => showToast('Accepted', 'success'))
                      .catch(() => showToast('Could not accept', 'error'))
                  }
                  onDecline={() =>
                    respond
                      .mutateAsync({ blockId: block.id, response: 'declined' })
                      .catch(() => showToast('Could not decline', 'error'))
                  }
                  busy={respond.isPending}
                />
              ))}
            </ProposalGroup>
          )}

          {acceptedByMe.length > 0 && (
            <ProposalGroup
              label="Accepted by you"
              count={acceptedByMe.length}
              tone="accepted"
            >
              {acceptedByMe.map((block) => (
                <ProposalRow
                  key={block.id}
                  block={block}
                  state="accepted"
                  partnerName={getPartnerName(block.partnershipId)}
                  color={getColor(block.partnershipId)}
                  onFlip={() =>
                    respond
                      .mutateAsync({ blockId: block.id, response: 'declined' })
                      .catch(() => showToast('Could not change response', 'error'))
                  }
                  busy={respond.isPending}
                />
              ))}
            </ProposalGroup>
          )}

          {declinedByMe.length > 0 && (
            <ProposalGroup
              label="Declined"
              count={declinedByMe.length}
              tone="declined"
            >
              {declinedByMe.map((block) => (
                <ProposalRow
                  key={block.id}
                  block={block}
                  state="declined"
                  partnerName={getPartnerName(block.partnershipId)}
                  color={getColor(block.partnershipId)}
                  onFlip={() =>
                    respond
                      .mutateAsync({ blockId: block.id, response: 'accepted' })
                      .catch(() => showToast('Could not change response', 'error'))
                  }
                  busy={respond.isPending}
                />
              ))}
            </ProposalGroup>
          )}

          {/* AI: opt-in natural-language reshuffle */}
          <NaturalReshuffleInput />

          {pending.length > 0 && (
            <div className="sticky bottom-20 sm:bottom-2 mt-2">
              <div className="bg-cream rounded-2xl shadow-letter border border-ink-100/60 p-3 flex items-center gap-3">
                <p className="flex-1 text-sm text-ink-700">
                  Happy with everything?
                </p>
                <Button onClick={acceptAll} loading={bulkPending}>
                  Accept all ({pending.length})
                </Button>
              </div>
            </div>
          )}

          {allDone && (
            <Card padding="md" className="bg-sage-50/60 border-sage-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-sage-500 text-cream flex items-center justify-center shrink-0">
                  <CheckIcon />
                </div>
                <div>
                  <p className="font-display text-ink-800 text-lg leading-tight">
                    All set on your end.
                  </p>
                  <p className="text-sm text-ink-600">
                    We'll notify you once everyone else has reviewed.
                  </p>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface ProposalGroupProps {
  label: string;
  count: number;
  tone: 'pending' | 'accepted' | 'declined';
  children: React.ReactNode;
}

function ProposalGroup({ label, count, tone, children }: ProposalGroupProps) {
  const dotColor = {
    pending: 'bg-terracotta-500',
    accepted: 'bg-sage-500',
    declined: 'bg-wine-500',
  }[tone];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
        <span className="eyebrow">
          {label} · {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

interface ProposalRowProps {
  block: TimeBlock;
  state: ViewerState;
  partnerName: string | undefined;
  color: string;
  busy?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  /** Flip an already-recorded response to its opposite. */
  onFlip?: () => void;
}

function ProposalRow({
  block,
  state,
  partnerName,
  color,
  busy,
  onAccept,
  onDecline,
  onFlip,
}: ProposalRowProps) {
  const start = parseISO(block.startTime);
  const end = parseISO(block.endTime);
  const dur = formatDuration(durationMinutes(block.startTime, block.endTime));

  const stateBg =
    state === 'accepted'
      ? 'bg-sage-50/50'
      : state === 'declined'
        ? 'bg-ink-50/60 opacity-80'
        : 'bg-cream';

  return (
    <Card padding="none" className={stateBg}>
      <div className="flex">
        <div
          className="w-1.5 rounded-l-2xl"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="meta-mono">{block.eventType}</span>
              <span className="text-ink-300">·</span>
              <span className="text-xs text-ink-500">{dur}</span>
              {state === 'accepted' && (
                <span className="ml-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] font-medium text-sage-700 bg-sage-100/70 px-1.5 py-0.5 rounded">
                  <CheckIcon size={10} />
                  Accepted
                </span>
              )}
              {state === 'declined' && (
                <span className="ml-1 text-[10px] uppercase tracking-[0.14em] font-medium text-wine-700 bg-wine-50 px-1.5 py-0.5 rounded">
                  Declined
                </span>
              )}
            </div>
            <p className="font-display text-ink-800 text-xl leading-tight">
              {block.eventLabel ?? formatDayShort(start)}
            </p>
            <p className="text-sm text-ink-600 mt-0.5">
              {formatDayShort(start)} · {formatTimeRange(start, end)}
              {partnerName ? ` · with ${partnerName}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {state === 'pending' ? (
              <>
                <Button size="sm" variant="ghost" onClick={onDecline} disabled={busy}>
                  Decline
                </Button>
                <Button size="sm" variant="primary" onClick={onAccept} disabled={busy}>
                  Accept
                </Button>
              </>
            ) : state === 'accepted' ? (
              <Button size="sm" variant="ghost" onClick={onFlip} disabled={busy}>
                Decline instead
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onFlip} disabled={busy}>
                Accept instead
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
