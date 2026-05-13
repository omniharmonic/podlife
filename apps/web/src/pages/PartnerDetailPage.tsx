import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { parseISO } from 'date-fns';
import type { RelationshipType } from '@pod-life/shared';
import { usePartnersList, useUpdateRelationshipType } from '@/hooks/usePartners';
import { useProposals } from '@/hooks/useSchedule';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';
import { Toggle } from '@/components/ui/Toggle';
import { ExplainScheduleButton } from '@/components/ai/ExplainScheduleButton';
import { PartnerPreferencesEditor } from '@/components/partners/PartnerPreferencesEditor';
import { useUiStore } from '@/stores/ui.store';
import { formatDayShort, formatTimeRange } from '@/lib/dates';

export function PartnerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { person } = useAuth();
  const partnersList = usePartnersList();
  const proposals = useProposals();
  const updateType = useUpdateRelationshipType(id);
  const showToast = useUiStore((s) => s.showToast);

  const partner = partnersList.data?.find((p) => p.partnershipId === id);

  async function onToggleFriendship(isFriendship: boolean) {
    const next: RelationshipType = isFriendship ? 'friendship' : 'partnership';
    try {
      await updateType.mutateAsync(next);
      showToast(
        next === 'friendship'
          ? 'Switched to friendship'
          : 'Switched to partnership',
        'success',
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not update',
        'error',
      );
    }
  }

  const sharedBlocks = useMemo(() => {
    return (proposals.data?.proposals ?? [])
      .filter((b) => b.partnershipId === id)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [proposals.data, id]);

  const stats = useMemo(() => {
    if (!person || !partner) return null;
    const sat = proposals.data?.satisfaction?.find((s) => s.person_id === person.id);
    return sat?.per_partner?.[partner.partner.id] ?? null;
  }, [proposals.data, partner, person]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-8"
    >
      <Link
        to="/partners"
        className="text-xs uppercase tracking-[0.16em] text-ink-500 hover:text-ink-800 inline-flex items-center gap-1 font-medium"
      >
        ← All partners
      </Link>

      {partner && (
        <header
          className="relative rounded-3xl overflow-hidden border border-ink-100/60 shadow-paper bg-cream"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-32"
            style={{
              background: `radial-gradient(80% 100% at 50% 0%, ${partner.color}33, transparent 70%), linear-gradient(180deg, ${partner.color}1A, transparent)`,
            }}
          />
          <div className="relative px-6 sm:px-8 pt-7 pb-6 flex flex-col sm:flex-row gap-5 sm:items-end">
            <Avatar
              name={partner.partner.displayName}
              src={partner.partner.avatarUrl ?? undefined}
              color={partner.color}
              size={104}
              className="ring-4 ring-cream shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="eyebrow mb-1.5">
                {partner.relationshipType === 'friendship' ? 'Friend' : 'Partner'}
              </p>
              <h1 className="font-display text-ink-800 text-[2.4rem] sm:text-[2.9rem] leading-[1.04] tracking-[-0.005em]">
                {partner.partner.displayName}
              </h1>
              {stats && (
                <p className="text-sm text-ink-600 mt-2">
                  This week ·{' '}
                  <span className="text-ink-800 font-medium tabular-nums">
                    {Math.round((stats.hours_scheduled ?? 0) * 10) / 10}h
                  </span>{' '}
                  together of{' '}
                  <span className="tabular-nums">
                    {Math.round((stats.hours_wanted ?? 0) * 10) / 10}h
                  </span>{' '}
                  hoped for
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {stats && (
                <SatisfactionRing
                  pct={stats.pref_pct ?? 0}
                  color={partner.color}
                  size={64}
                />
              )}
              <ExplainScheduleButton size="sm" />
            </div>
          </div>
        </header>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-7">
        <section className="flex flex-col gap-6">
          {partner && (
            <Card padding="md">
              <Toggle
                checked={partner.relationshipType === 'friendship'}
                onChange={onToggleFriendship}
                label="This is a friendship, not a partnership"
                description="Friendships hide overnight and date-night fields. Same scheduling, less romantic baggage."
              />
            </Card>
          )}
          {partner ? (
            <PartnerPreferencesEditor
              partnershipId={id}
              partnerName={partner.partner.displayName}
              relationshipType={partner.relationshipType}
              cadence={partner.cadence}
              pendingCadence={partner.pendingCadence}
              pendingProposedByMe={
                partner.pendingCadenceBy == null
                  ? null
                  : partner.pendingCadenceBy === person?.id
              }
            />
          ) : (
            <p className="text-ink-500 text-sm">Loading…</p>
          )}
        </section>

        <aside className="flex flex-col gap-3">
          <h3 className="font-display text-ink-800 text-xl">
            Time together this week
          </h3>
          {sharedBlocks.length === 0 ? (
            <Card as="dashed" padding="md">
              <p className="text-sm text-ink-500">Nothing scheduled yet.</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {sharedBlocks.slice(0, 8).map((b) => {
                const start = parseISO(b.startTime);
                const end = parseISO(b.endTime);
                return (
                  <li key={b.id}>
                    <Card padding="sm" className="flex gap-3 items-center">
                      <div
                        className="w-1 h-10 rounded-full shrink-0"
                        style={{ backgroundColor: partner?.color ?? '#7A9A85' }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-display text-ink-800 text-[15px] leading-tight truncate">
                          {b.eventLabel ?? b.eventType}
                        </p>
                        <p className="text-[11px] text-ink-500 tabular-nums mt-0.5">
                          {formatDayShort(start)} · {formatTimeRange(start, end)}
                        </p>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </motion.div>
  );
}
