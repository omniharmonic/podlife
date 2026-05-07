import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getWeek, getYear } from 'date-fns';
import type { TimeBlock } from '@pod-life/shared';
import { useProposals, useRunCycle } from '@/hooks/useSchedule';
import { usePartnersList } from '@/hooks/usePartners';
import { WeekView } from '@/components/calendar/WeekView';
import { Button } from '@/components/ui/Button';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/ui.store';
import { formatWeekRange } from '@/lib/dates';

export function CalendarPage() {
  const { person } = useAuth();
  const proposals = useProposals();
  const partners = usePartnersList();
  const runCycle = useRunCycle();
  const showToast = useUiStore((s) => s.showToast);
  const selectedWeekStart = useUiStore((s) => s.selectedWeekStart);

  const blocks = proposals.data?.proposals ?? [];
  const partnerList = partners.data ?? [];
  const satisfaction = proposals.data?.satisfaction ?? [];

  const mySatisfaction = useMemo(() => {
    if (!person) return null;
    return satisfaction.find((s) => s.person_id === person.id) ?? null;
  }, [satisfaction, person]);

  const pendingCount = useMemo(
    () =>
      blocks.filter(
        (b: TimeBlock) =>
          b.status === 'proposed' && (b.myResponse ?? 'pending') === 'pending',
      ).length,
    [blocks],
  );

  const weekNumber = getWeek(selectedWeekStart, { weekStartsOn: 1 });
  const year = getYear(selectedWeekStart);

  async function handleRunCycle() {
    try {
      await runCycle.mutateAsync();
      showToast('Building your schedule…', 'info');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not start a cycle',
        'error',
      );
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-6"
    >
      {/* Masthead */}
      <header className="flex flex-col gap-1">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow mb-1.5">
              Week {weekNumber} · {year}
            </p>
            <h1 className="font-display text-ink-800 text-[2.4rem] sm:text-[2.9rem] leading-[1.04] tracking-[-0.005em]">
              {formatWeekRange(selectedWeekStart)}
            </h1>
          </div>
          {mySatisfaction && (
            <SatisfactionRing pct={mySatisfaction.overall_pct * 100} size={64} />
          )}
        </div>
      </header>

      {/* Pending proposals banner */}
      {pendingCount > 0 && (
        <Link
          to="/schedule/review"
          className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-ink rounded-2xl group"
        >
          <Card padding="md" className="border-terracotta-200 bg-terracotta-50/40">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-terracotta-500 text-cream flex items-center justify-center font-display text-lg shrink-0 tabular-nums">
                {pendingCount}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-ink-800 text-lg leading-tight">
                  {pendingCount === 1 ? 'A proposal is waiting' : `${pendingCount} proposals are waiting`}
                </p>
                <p className="text-sm text-ink-600 mt-0.5">Review and respond.</p>
              </div>
              <span className="text-terracotta-600 text-2xl group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
          </Card>
        </Link>
      )}

      {/* Empty state */}
      {!proposals.isLoading && blocks.length === 0 && (
        <Card as="dashed" padding="lg">
          <EmptyState
            title="Your week is unmarked"
            description="When you've added partners and set preferences, you can ask Pod Life to draft a fair schedule."
            action={
              <div className="flex flex-col items-center gap-3">
                <Button
                  variant="primary"
                  loading={runCycle.isPending}
                  onClick={handleRunCycle}
                  disabled={partnerList.length === 0}
                >
                  Build a schedule
                </Button>
                {partnerList.length === 0 && (
                  <Link to="/partners">
                    <Button variant="ghost">Add a partner first</Button>
                  </Link>
                )}
              </div>
            }
          />
        </Card>
      )}

      {/* Calendar */}
      {(proposals.isLoading || blocks.length > 0) && (
        <WeekView blocks={blocks} partners={partnerList} />
      )}

      {/* Partner pulse strip */}
      {mySatisfaction && partnerList.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-ink-800 text-2xl">
              Time together this cycle
            </h2>
          </div>
          <Card padding="md">
            <div className="flex flex-wrap gap-5 sm:gap-7 items-start">
              {partnerList.map((p) => {
                const stats = mySatisfaction.per_partner[p.partner.id];
                const pct = stats?.pref_pct != null ? stats.pref_pct * 100 : 0;
                return (
                  <SatisfactionRing
                    key={p.partnershipId}
                    pct={pct}
                    color={p.color}
                    size={60}
                    label={p.partner.displayName.split(/\s+/)[0]}
                  />
                );
              })}
            </div>
          </Card>
        </section>
      )}
    </motion.div>
  );
}
