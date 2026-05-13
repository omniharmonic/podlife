import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { parseISO, formatDistanceToNowStrict } from 'date-fns';
import type { PartnerSummary } from '@pod-life/shared';
import { Avatar } from '@/components/ui/Avatar';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';
import { useAuth } from '@/hooks/useAuth';
import { PartnerPreferencesEditor } from './PartnerPreferencesEditor';

interface PartnerCardProps {
  partner: PartnerSummary;
  /** 0–100 satisfaction percentage, optional. */
  satisfactionPct?: number;
  /** ISO string for the next scheduled block. */
  nextBlockAt?: string;
  /** "you've shared 6h this cycle"-style caption. */
  sharedSnippet?: string;
}

/**
 * Partner card — feels like a piece of stationery, but legible and modern.
 * Tap to expand inline preferences. The accent stripe + soft tint use the
 * partner's color so each card feels personally addressed.
 */
export function PartnerCard({
  partner,
  satisfactionPct,
  nextBlockAt,
  sharedSnippet,
}: PartnerCardProps) {
  const [open, setOpen] = useState(false);
  const { person } = useAuth();
  const name = partner.partner.displayName;
  const color = partner.color;

  return (
    <article
      className="relative bg-cream border border-ink-100/60 rounded-2xl shadow-paper overflow-hidden"
    >
      {/* Soft tint wash from the accent color */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-20"
        style={{
          background: `linear-gradient(180deg, ${color}1F, transparent 90%)`,
        }}
      />
      {/* Color stripe */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: color }}
      />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative w-full text-left p-5 sm:p-6 flex items-center gap-4 hover:bg-ink-50/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
        aria-expanded={open}
      >
        <Avatar
          name={name}
          src={partner.partner.avatarUrl ?? undefined}
          size={64}
          color={color}
          className="ring-2 ring-cream"
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-ink-800 text-[1.5rem] leading-tight tracking-[-0.005em] truncate">
              {name}
            </h3>
            {partner.status === 'invited' && (
              <span className="text-[10px] uppercase tracking-[0.14em] font-medium text-terracotta-700 bg-terracotta-50 border border-terracotta-200 px-1.5 py-0.5 rounded-full">
                Invited
              </span>
            )}
            {partner.status === 'paused' && (
              <span className="text-[10px] uppercase tracking-[0.14em] font-medium text-ink-500 bg-ink-50 border border-ink-100 px-1.5 py-0.5 rounded-full">
                Paused
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {nextBlockAt ? (
              <span className="text-[13px] text-ink-600">
                Next together{' '}
                <span className="text-ink-800 font-medium">
                  {formatDistanceToNowStrict(parseISO(nextBlockAt), { addSuffix: true })}
                </span>
              </span>
            ) : sharedSnippet ? (
              <span className="text-[13px] text-ink-600">{sharedSnippet}</span>
            ) : (
              <span className="text-[13px] text-ink-500">
                {open ? 'Edit preferences below' : 'Tap to view preferences'}
              </span>
            )}
          </div>
        </div>
        {typeof satisfactionPct === 'number' && (
          <SatisfactionRing pct={satisfactionPct} size={56} color={color} />
        )}
        <span
          aria-hidden="true"
          className="text-ink-400 text-lg pl-2 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ›
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.section
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="relative overflow-hidden"
          >
            <div className="px-5 sm:px-6 pb-6 pt-2 border-t border-ink-100/60">
              <div className="flex justify-end mb-4">
                <Link
                  to={`/partners/${partner.partnershipId}`}
                  className="text-[11px] uppercase tracking-[0.16em] font-medium text-terracotta-600 hover:underline"
                >
                  Open full view →
                </Link>
              </div>
              <PartnerPreferencesEditor
                partnershipId={partner.partnershipId}
                partnerName={name}
                relationshipType={partner.relationshipType}
                cadence={partner.cadence}
                pendingCadence={partner.pendingCadence}
                pendingProposedByMe={
                  partner.pendingCadenceBy == null
                    ? null
                    : partner.pendingCadenceBy === person?.id
                }
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </article>
  );
}
