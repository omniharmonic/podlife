import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { isToday, parseISO, formatDistanceToNowStrict } from 'date-fns';
import type { TimeBlock } from '@pod-life/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProposals, useRunCycle } from '@/hooks/useSchedule';
import { usePartnersList } from '@/hooks/usePartners';
import { usePodsList } from '@/hooks/usePods';
import {
  useNotifications,
  useMarkNotificationRead,
  usePodHealth,
} from '@/hooks/usePodExtras';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';
import { Avatar } from '@/components/ui/Avatar';
import { useUiStore } from '@/stores/ui.store';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { passkeys as passkeysApi } from '@/lib/api';
import { enrollPasskey, isPasskeySupported } from '@/lib/passkeys';
import { formatTimeRange } from '@/lib/dates';

const PASSKEY_NUDGE_KEY = 'podlife.passkeyNudge.dismissed';

/**
 * Home — the daily landing surface. Three jobs in priority order:
 *   1. Surface what needs attention (pending proposals, alerts).
 *   2. Show today at a glance.
 *   3. Show pod health so you know how things are landing.
 */
export function HomePage() {
  const { person } = useAuth();
  const proposals = useProposals();
  const partners = usePartnersList();
  const pods = usePodsList();
  const notifs = useNotifications();
  const markRead = useMarkNotificationRead();
  const runCycle = useRunCycle();
  const showToast = useUiStore((s) => s.showToast);
  const install = useInstallPrompt();
  const queryClient = useQueryClient();

  // Passkey nudge — quiet "skip the email next time" card, only when the
  // platform supports passkeys, the user has none yet, and they haven't
  // dismissed the nudge before. Same pattern as the install card.
  const passkeySupported = isPasskeySupported();
  const passkeysQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => passkeysApi.list(),
    select: (d) => d.passkeys,
    enabled: passkeySupported,
  });
  const [passkeyDismissed, setPasskeyDismissed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(PASSKEY_NUDGE_KEY) === '1';
  });
  const [enrollBusy, setEnrollBusy] = useState(false);
  const passkeyCount = passkeysQuery.data?.length ?? 0;
  const showPasskeyNudge =
    passkeySupported &&
    passkeysQuery.isSuccess &&
    passkeyCount === 0 &&
    !passkeyDismissed;

  async function onEnrollPasskey() {
    if (enrollBusy) return;
    setEnrollBusy(true);
    try {
      const result = await enrollPasskey();
      if (result.status === 'enrolled') {
        await queryClient.invalidateQueries({ queryKey: ['passkeys'] });
        showToast('Passkey saved — sign-in is one tap from now on', 'success');
      } else if (result.status === 'error') {
        showToast(result.message, 'error');
      }
    } finally {
      setEnrollBusy(false);
    }
  }

  function dismissPasskeyNudge() {
    setPasskeyDismissed(true);
    try {
      localStorage.setItem(PASSKEY_NUDGE_KEY, '1');
    } catch {
      /* private mode — fall through */
    }
  }

  const greeting = useMemo(() => greetingForHour(new Date()), []);
  const blocks = useMemo(() => proposals.data?.proposals ?? [], [proposals.data]);

  const pending = useMemo(
    () => blocks.filter((b) => (b.myResponse ?? 'pending') === 'pending' && b.status === 'proposed'),
    [blocks],
  );

  const todayBlocks = useMemo(
    () =>
      blocks
        .filter((b) => isToday(parseISO(b.startTime)))
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [blocks],
  );

  const upcoming = useMemo(() => {
    const now = Date.now();
    return blocks
      .filter((b) => parseISO(b.startTime).getTime() > now)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  }, [blocks]);

  const mySat = useMemo(() => {
    if (!person) return null;
    return (
      proposals.data?.satisfaction?.find((s) => s.person_id === person.id) ?? null
    );
  }, [proposals.data, person]);

  const partnerByPersonId = useMemo(() => {
    const m = new Map<string, { name: string; color: string; avatarUrl?: string | null }>();
    for (const p of partners.data ?? []) {
      m.set(p.partner.id, {
        name: p.partner.displayName,
        color: p.color,
        avatarUrl: p.partner.avatarUrl,
      });
    }
    return m;
  }, [partners.data]);

  const partnerByPartnership = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const p of partners.data ?? []) {
      m.set(p.partnershipId, { name: p.partner.displayName, color: p.color });
    }
    return m;
  }, [partners.data]);

  const unreadNotifs = (notifs.data?.notifications ?? []).filter((n) => !n.readAt);
  const visibleNotifs = unreadNotifs.slice(0, 3);

  // Single primary pod for inline health glance.
  const primaryPod = (pods.data ?? [])[0] ?? null;

  async function handleRunCycle() {
    try {
      await runCycle.mutateAsync();
      showToast('Looking at this week — back in a moment…', 'info');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Couldn't get the check-in started — try again?",
        'error',
      );
    }
  }

  async function markAllRead() {
    await Promise.allSettled(
      unreadNotifs.map((n) => markRead.mutateAsync(n.id)),
    );
  }

  const hasPartners = (partners.data ?? []).length > 0;
  const firstName = person?.displayName.split(/\s+/)[0] ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-7"
    >
      {/* Greeting */}
      <section className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5">{greeting.eyebrow}</p>
          <h1 className="font-display text-ink-800 text-[2.4rem] sm:text-[2.9rem] leading-[1.04] tracking-[-0.005em]">
            {greeting.line}
            {firstName ? `, ${firstName}` : ''}.
          </h1>
        </div>
        {mySat && (
          <div className="hidden sm:flex">
            <SatisfactionRing
              pct={mySat.overall_pct * 100}
              size={64}
              label="for you"
            />
          </div>
        )}
      </section>

      {/* Pending proposals — most urgent */}
      {pending.length > 0 && (
        <Link to="/schedule/review" className="block group">
          <Card padding="md" className="border-terracotta-200 bg-terracotta-50/40 hover:shadow-letter transition-shadow">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-terracotta-500 text-cream flex items-center justify-center shrink-0 shadow-sm font-display text-xl tabular-nums">
                {pending.length}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-ink-800 text-xl leading-tight">
                  {pending.length === 1 ? 'A proposal is waiting' : `${pending.length} proposals are waiting`}
                </p>
                <p className="text-sm text-ink-600 mt-0.5">
                  Tap to review and respond.
                </p>
              </div>
              <span className="text-terracotta-600 text-2xl group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
          </Card>
        </Link>
      )}

      {/* Today */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-ink-800 text-2xl">Today</h2>
          <Link
            to="/calendar"
            className="text-[11px] uppercase tracking-[0.16em] text-terracotta-600 hover:underline font-medium"
          >
            Calendar →
          </Link>
        </div>
        {todayBlocks.length === 0 ? (
          <Card as="dashed" padding="md">
            <p className="text-sm text-ink-500">
              {upcoming
                ? `No blocks today. Next up: ${upcoming.eventLabel ?? upcoming.eventType}, ${formatDistanceToNowStrict(parseISO(upcoming.startTime), { addSuffix: true })}.`
                : 'No locked blocks today. The day is yours.'}
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {todayBlocks.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                partner={
                  b.partnershipId ? partnerByPartnership.get(b.partnershipId) : undefined
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* Pod health */}
      {primaryPod && (
        <PodHealthCard podId={primaryPod.id} podName={primaryPod.name} />
      )}

      {/* Partner pulse — quick-glance rings */}
      {hasPartners && mySat && Object.keys(mySat.per_partner ?? {}).length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-ink-800 text-2xl">Time together</h2>
            <Link
              to="/partners"
              className="text-[11px] uppercase tracking-[0.16em] text-terracotta-600 hover:underline font-medium"
            >
              Partners →
            </Link>
          </div>
          <Card padding="md">
            <div className="flex flex-wrap items-start gap-5">
              {Object.entries(mySat.per_partner).map(([partnerId, stats]) => {
                const meta = partnerByPersonId.get(partnerId);
                const scheduled = stats.hours_scheduled ?? 0;
                const wanted = stats.hours_wanted ?? 0;
                // Format helpers: 2.5 → "2.5h"; 3 → "3h" (drop trailing .0)
                const fmt = (h: number): string =>
                  Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
                const tooltip =
                  wanted > 0
                    ? `${fmt(scheduled)} of ${fmt(wanted)} this week`
                    : `${fmt(scheduled)} this week`;
                return (
                  <Link
                    key={partnerId}
                    to="/partners"
                    className="flex flex-col items-center gap-2 px-2"
                    title={tooltip}
                  >
                    <Avatar
                      name={meta?.name ?? '?'}
                      src={meta?.avatarUrl ?? undefined}
                      color={meta?.color}
                      size={48}
                    />
                    <span className="text-[12px] text-ink-700 font-medium truncate max-w-[80px] text-center">
                      {(meta?.name ?? '').split(/\s+/)[0]}
                    </span>
                    <span
                      className="text-[11px] tabular-nums font-medium"
                      style={{ color: meta?.color ?? undefined }}
                    >
                      {wanted > 0
                        ? `${fmt(scheduled)} / ${fmt(wanted)}`
                        : fmt(scheduled)}
                    </span>
                    {!stats.need_met && (
                      <span className="text-[9.5px] uppercase tracking-[0.14em] text-wine-600 font-medium">
                        below need
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      {/* Passkey nudge — invite the user to skip the code next time.
          Quiet, one-tap, dismissable. Hidden once they have any passkey
          or have dismissed it. */}
      {showPasskeyNudge && (
        <section>
          <Card padding="md" className="border-sage-200/70 bg-sage-50/40">
            <div className="flex items-start gap-4">
              <span aria-hidden="true" className="mt-0.5 text-2xl shrink-0">
                🔐
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-display text-ink-800 text-[1.35rem] leading-tight tracking-[-0.005em]">
                  Skip the email next time
                </p>
                <p className="text-sm text-ink-600 mt-1.5 leading-relaxed">
                  Save a passkey on this device — Face ID or Touch ID will
                  sign you in instantly, no code to wait for.
                </p>
                <div className="flex items-center gap-3 mt-3.5">
                  <Button size="sm" onClick={onEnrollPasskey} loading={enrollBusy}>
                    Save a passkey
                  </Button>
                  <button
                    type="button"
                    onClick={dismissPasskeyNudge}
                    className="text-[12px] text-ink-500 hover:text-ink-700 underline-offset-4 hover:underline"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* Install nudge — a quiet, dismissable home-screen invitation. Only
          shows once partners exist (post-onboarding) and the platform can
          actually install. Sticky-dismissed via localStorage. */}
      {install.showNudge && hasPartners && (
        <section>
          <Card padding="md" className="border-terracotta-200/70 bg-terracotta-50/40">
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="mt-0.5 text-2xl shrink-0"
                style={{ filter: 'saturate(0.95)' }}
              >
                🏡
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-display text-ink-800 text-[1.35rem] leading-tight tracking-[-0.005em]">
                  Pod Life lives best on your home screen
                </p>
                <p className="text-sm text-ink-600 mt-1.5 leading-relaxed">
                  {install.isIOS
                    ? "Tap the Share icon, then \"Add to Home Screen\" — it'll open like an app and stay signed in."
                    : 'Add it to your home screen and it opens straight to today, signed in, no browser around it.'}
                </p>
                <div className="flex items-center gap-3 mt-3.5">
                  {install.canPrompt && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        const outcome = await install.promptInstall();
                        if (outcome === 'accepted') {
                          showToast('Pod Life is on your home screen', 'success');
                        }
                      }}
                    >
                      Add to home screen
                    </Button>
                  )}
                  {install.isIOS && (
                    <Link to="/settings">
                      <Button variant="ghost" size="sm">
                        Show me how
                      </Button>
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={install.dismiss}
                    className="text-[12px] text-ink-500 hover:text-ink-700 underline-offset-4 hover:underline"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* Notifications */}
      {visibleNotifs.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-ink-800 text-2xl">Updates</h2>
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] uppercase tracking-[0.16em] text-terracotta-600 hover:underline font-medium"
            >
              Mark all read
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {visibleNotifs.map((n, i) => (
              <motion.li
                key={n.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
              >
                <NotificationCard
                  title={n.title}
                  body={n.body}
                  createdAt={n.createdAt}
                  actionUrl={n.actionUrl}
                  onOpen={() => markRead.mutateAsync(n.id).catch(() => {})}
                />
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      {/* Quick actions */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-ink-800 text-2xl">Quick actions</h2>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={handleRunCycle} loading={runCycle.isPending} disabled={!hasPartners}>
            Find time
          </Button>
          <Link to="/partners">
            <Button variant="ghost">
              {hasPartners ? 'Adjust your hopes' : 'Invite a partner'}
            </Button>
          </Link>
          {primaryPod && (
            <Link to={`/pods/${primaryPod.id}`}>
              <Button variant="ghost">Open {primaryPod.name}</Button>
            </Link>
          )}
        </div>
      </section>
    </motion.div>
  );
}

function greetingForHour(d: Date): { eyebrow: string; line: string } {
  const h = d.getHours();
  if (h < 5) return { eyebrow: 'Late', line: 'Still up' };
  if (h < 12) return { eyebrow: 'Morning', line: 'Good morning' };
  if (h < 17) return { eyebrow: 'Afternoon', line: 'Good afternoon' };
  if (h < 22) return { eyebrow: 'Evening', line: 'Good evening' };
  return { eyebrow: 'Late', line: 'A quiet night' };
}

interface BlockRowProps {
  block: TimeBlock;
  partner: { name: string; color: string } | undefined;
}

function BlockRow({ block, partner }: BlockRowProps) {
  const start = parseISO(block.startTime);
  const end = parseISO(block.endTime);
  return (
    <li>
      <Card padding="sm" className="flex items-center gap-3.5">
        <div
          className="w-1 h-12 rounded-full shrink-0"
          style={{ backgroundColor: partner?.color ?? '#7A9A85' }}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500 font-medium tabular-nums">
            {formatTimeRange(start, end)}
          </p>
          <p className="font-display text-ink-800 text-[1.15rem] leading-tight truncate mt-0.5">
            {block.eventLabel ?? block.eventType}
            {partner && (
              <span className="text-ink-500"> with {partner.name}</span>
            )}
          </p>
        </div>
      </Card>
    </li>
  );
}

interface PodHealthCardProps {
  podId: string;
  podName: string;
}

function PodHealthCard({ podId, podName }: PodHealthCardProps) {
  const health = usePodHealth(podId);
  const data = health.data;
  const hasData = data && data.members.length > 0;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display text-ink-800 text-2xl">Pod health</h2>
        <Link
          to={`/pods/${podId}`}
          className="text-[11px] uppercase tracking-[0.16em] text-terracotta-600 hover:underline font-medium"
        >
          {podName} →
        </Link>
      </div>
      {!hasData ? (
        <Card as="dashed" padding="md">
          <p className="text-sm text-ink-500">
            {health.isLoading ? 'Listening for the pulse…' : 'Health metrics will appear after your first cycle.'}
          </p>
        </Card>
      ) : (
        <Card padding="md">
          <div className="flex items-center gap-5">
            <SatisfactionRing
              pct={(data.podSatisfactionPct ?? 0) * 100}
              size={88}
              strokeWidth={3}
            />
            <div className="flex-1 min-w-0 flex flex-wrap gap-3">
              {data.members.map((m) => (
                <div key={m.personId} className="flex items-center gap-2">
                  <Avatar name={m.displayName} src={m.avatarUrl ?? undefined} size={32} />
                  <div className="flex flex-col leading-tight">
                    <span className="text-[12.5px] text-ink-800 font-medium truncate max-w-[120px]">
                      {m.displayName.split(/\s+/)[0]}
                    </span>
                    <span className="text-[10.5px] text-ink-500 tabular-nums">
                      {Math.round(m.satisfactionPct * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {data.observations.length > 0 && (
            <p className="text-[14px] text-ink-700 leading-relaxed mt-4 pt-4 border-t border-ink-100/70">
              {data.observations[0]}
            </p>
          )}
        </Card>
      )}
    </section>
  );
}

interface NotifCardProps {
  title: string;
  body: string;
  createdAt: string;
  actionUrl: string | null;
  onOpen: () => void;
}

function NotificationCard({ title, body, createdAt, actionUrl, onOpen }: NotifCardProps) {
  const ago = formatDistanceToNowStrict(parseISO(createdAt), { addSuffix: true });
  const content = (
    <Card padding="sm" interactive={Boolean(actionUrl)} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-ink-800 text-[1.05rem] leading-tight">
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-400 font-medium tabular-nums shrink-0">
          {ago}
        </span>
      </div>
      <p className="text-[14px] text-ink-600 leading-relaxed">{body}</p>
    </Card>
  );
  if (actionUrl) {
    return (
      <Link to={actionUrl} onClick={onOpen} className="block">
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="text-left w-full">
      {content}
    </button>
  );
}
