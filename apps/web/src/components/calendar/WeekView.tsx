import { useMemo, useState } from 'react';
import { isSameDay, parseISO } from 'date-fns';
import type { TimeBlock as TimeBlockType, PartnerSummary } from '@pod-life/shared';
import { TimeBlock } from './TimeBlock';
import { TimeBlockDetailModal } from './TimeBlockDetailModal';
import { useUiStore } from '@/stores/ui.store';
import {
  formatWeekRange,
  getWeekDays,
  format,
} from '@/lib/dates';

const ABSOLUTE_DAY_START = 0;
const ABSOLUTE_DAY_END = 24;
const DEFAULT_DAY_START = 8;
const DEFAULT_DAY_END = 23;
const HOUR_HEIGHT_PX = 56;
/** Pad the active range so blocks have breathing room on either edge. */
const HOUR_PADDING = 1;

interface WeekViewProps {
  blocks: TimeBlockType[];
  partners: PartnerSummary[];
}

/**
 * Calendar-aware ranges:
 *
 *   - "Active" hours are determined by the union of all visible blocks across
 *     the week, padded by ±1 hour. Empty pre-dawn / late-night rows collapse
 *     so the calendar reads as Pod Life events, not a primary calendar
 *     replacement. If no blocks exist, fall back to a sensible default window.
 *   - Mobile (single-day) uses the same union for grid alignment, so swiping
 *     between days doesn't re-flow.
 */
function computeActiveHours(blocks: TimeBlockType[], days: Date[]): { start: number; end: number } {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const b of blocks) {
    const start = parseISO(b.startTime);
    const end = parseISO(b.endTime);
    if (!days.some((d) => isSameDay(d, start))) continue;
    const sH = start.getHours() + start.getMinutes() / 60;
    const eH = end.getHours() + end.getMinutes() / 60;
    if (sH < earliest) earliest = sH;
    if (eH > latest) latest = eH;
  }
  if (!Number.isFinite(earliest)) {
    return { start: DEFAULT_DAY_START, end: DEFAULT_DAY_END };
  }
  const start = Math.max(ABSOLUTE_DAY_START, Math.floor(earliest) - HOUR_PADDING);
  const end = Math.min(ABSOLUTE_DAY_END, Math.ceil(latest) + HOUR_PADDING);
  // Don't let the calendar collapse to less than 6 hours of context.
  if (end - start < 6) {
    const pad = (6 - (end - start)) / 2;
    return {
      start: Math.max(ABSOLUTE_DAY_START, Math.floor(start - pad)),
      end: Math.min(ABSOLUTE_DAY_END, Math.ceil(end + pad)),
    };
  }
  return { start, end };
}

export function WeekView({ blocks, partners }: WeekViewProps) {
  const selectedWeekStart = useUiStore((s) => s.selectedWeekStart);
  const navigateWeek = useUiStore((s) => s.navigateWeek);
  const days = useMemo(() => getWeekDays(selectedWeekStart), [selectedWeekStart]);
  const { start: dayStart, end: dayEnd } = useMemo(
    () => computeActiveHours(blocks, days),
    [blocks, days],
  );
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = dayStart; h < dayEnd; h++) out.push(h);
    return out;
  }, [dayStart, dayEnd]);

  const [selectedBlock, setSelectedBlock] = useState<TimeBlockType | null>(null);

  const [mobileDayIdx, setMobileDayIdx] = useState(() => {
    const today = new Date();
    const idx = days.findIndex((d) => isSameDay(d, today));
    return idx >= 0 ? idx : 0;
  });

  const partnerByPartnership = useMemo(() => {
    const map = new Map<string, PartnerSummary>();
    for (const p of partners) map.set(p.partnershipId, p);
    return map;
  }, [partners]);

  function getBlockColor(block: TimeBlockType): string {
    if (block.partnershipId) {
      const partner = partnerByPartnership.get(block.partnershipId);
      if (partner?.color) return partner.color;
    }
    return '#81B29A';
  }

  function getBlockContextLabel(block: TimeBlockType): string | undefined {
    if (block.partnershipId) {
      const partner = partnerByPartnership.get(block.partnershipId);
      return partner?.partner.displayName;
    }
    if (block.sourcePodId) return 'Pod';
    return undefined;
  }

  const weekHasBlocks = blocks.some((b) =>
    days.some((d) => isSameDay(d, parseISO(b.startTime))),
  );

  return (
    <>
      <div className="flex flex-col bg-cream sm:rounded-2xl sm:shadow-paper sm:border sm:border-ink-100/60 overflow-hidden">
        {/* Week navigation */}
        <div className="flex items-center justify-between px-4 py-3 bg-cream border-b border-ink-100/60">
          <button
            type="button"
            onClick={() => navigateWeek('prev')}
            className="p-2 rounded-full hover:bg-ink-50 text-ink-500"
            aria-label="Previous week"
          >
            <ChevronLeft />
          </button>
          <div className="flex flex-col items-center">
            <h2 className="text-xs uppercase tracking-[0.16em] text-ink-700 font-medium">
              {formatWeekRange(selectedWeekStart)}
            </h2>
            <button
              type="button"
              onClick={() => navigateWeek('today')}
              className="text-[10px] text-terracotta-600 uppercase tracking-[0.16em] font-medium hover:underline mt-0.5"
            >
              Today
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigateWeek('next')}
            className="p-2 rounded-full hover:bg-ink-50 text-ink-500"
            aria-label="Next week"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Collapsed indicator */}
        {weekHasBlocks && (dayStart > ABSOLUTE_DAY_START || dayEnd < ABSOLUTE_DAY_END) && (
          <div className="px-4 py-1.5 bg-parchment/70 border-b border-ink-100/60 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ink-500 font-medium">
            <span aria-hidden="true">⋯</span>
            <span>
              Showing {format12Hour(dayStart)} – {format12Hour(dayEnd)} · empty hours hidden
            </span>
            <span aria-hidden="true">⋯</span>
          </div>
        )}

        {/* Mobile: day pill nav */}
        <div className="sm:hidden flex justify-between gap-1 px-2 py-2 bg-cream border-b border-ink-100/60 overflow-x-auto">
          {days.map((day, i) => {
            const isActive = i === mobileDayIdx;
            const isTodayDay = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setMobileDayIdx(i)}
                className={`flex-1 min-w-12 flex flex-col items-center py-1.5 rounded-md transition-colors ${
                  isActive
                    ? 'bg-ink-800 text-cream'
                    : isTodayDay
                      ? 'bg-ink-50 text-terracotta-600'
                      : 'text-ink-600 hover:bg-ink-50'
                }`}
              >
                <span className="text-[10px] uppercase tracking-[0.14em] font-medium">
                  {format(day, 'EEE')}
                </span>
                <span className="font-display text-lg leading-none mt-0.5">
                  {format(day, 'd')}
                </span>
              </button>
            );
          })}
        </div>

        {/* Day Headers (desktop) */}
        <div className="hidden sm:grid sm:grid-cols-[60px_repeat(7,1fr)] border-b border-ink-100/60 bg-cream">
          <div />
          {days.map((day) => {
            const isTodayDay = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={`text-center py-3 ${
                  isTodayDay ? 'text-terracotta-600' : 'text-ink-500'
                }`}
              >
                <div className="text-[10px] uppercase tracking-[0.14em] font-medium">
                  {format(day, 'EEE')}
                </div>
                <div
                  className={`mt-1 font-display ${
                    isTodayDay
                      ? 'inline-flex items-center justify-center w-9 h-9 rounded-full bg-terracotta-500 text-cream'
                      : 'text-ink-800'
                  }`}
                  style={{ fontSize: '1.4rem' }}
                >
                  {format(day, 'd')}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div className="flex-1 overflow-y-auto">
          {/* Desktop: 7 column grid */}
          <div className="hidden sm:grid sm:grid-cols-[60px_repeat(7,1fr)]">
            {/* Hour rail */}
            <div className="bg-cream relative">
              {hours.map((h) => (
                <div
                  key={h}
                  className="text-[10px] text-ink-400 text-right pr-2 pt-0.5 border-b border-ink-100/60 tabular-nums"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                >
                  {format12Hour(h)}
                </div>
              ))}
            </div>
            {days.map((day) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                hours={hours}
                dayStart={dayStart}
                blocks={blocks.filter((b) => isSameDay(parseISO(b.startTime), day))}
                getColor={getBlockColor}
                getContext={getBlockContextLabel}
                onSelectBlock={setSelectedBlock}
              />
            ))}
          </div>

          {/* Mobile: single day view */}
          <div className="sm:hidden grid grid-cols-[50px_1fr]">
            <div className="bg-cream">
              {hours.map((h) => (
                <div
                  key={h}
                  className="text-[10px] text-ink-400 text-right pr-2 pt-0.5 border-b border-ink-100/60 tabular-nums"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                >
                  {format12Hour(h)}
                </div>
              ))}
            </div>
            {(() => {
              const day = days[mobileDayIdx] ?? days[0]!;
              return (
                <DayColumn
                  day={day}
                  hours={hours}
                  dayStart={dayStart}
                  blocks={blocks.filter((b) => isSameDay(parseISO(b.startTime), day))}
                  getColor={getBlockColor}
                  getContext={getBlockContextLabel}
                  onSelectBlock={setSelectedBlock}
                />
              );
            })()}
          </div>
        </div>
      </div>

      <TimeBlockDetailModal
        block={selectedBlock}
        onClose={() => setSelectedBlock(null)}
        contextLabel={selectedBlock ? getBlockContextLabel(selectedBlock) : undefined}
        color={selectedBlock ? getBlockColor(selectedBlock) : undefined}
      />
    </>
  );
}

function format12Hour(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return '12 am';
  if (hour === 12) return '12 pm';
  if (hour < 12) return `${hour} am`;
  return `${hour - 12} pm`;
}

interface DayColumnProps {
  day: Date;
  hours: number[];
  dayStart: number;
  blocks: TimeBlockType[];
  getColor: (block: TimeBlockType) => string;
  getContext: (block: TimeBlockType) => string | undefined;
  onSelectBlock: (block: TimeBlockType) => void;
}

function DayColumn({
  day,
  hours,
  dayStart,
  blocks,
  getColor,
  getContext,
  onSelectBlock,
}: DayColumnProps) {
  return (
    <div
      key={day.toISOString()}
      className="relative border-l border-ink-100/60 bg-cream"
    >
      {hours.map((h) => (
        <div
          key={h}
          className="border-b border-ink-100/60"
          style={{ height: `${HOUR_HEIGHT_PX}px` }}
        />
      ))}
      {blocks.map((block) => (
        <TimeBlock
          key={block.id}
          block={block}
          color={getColor(block)}
          contextLabel={getContext(block)}
          dayStartHour={dayStart}
          hourHeight={HOUR_HEIGHT_PX}
          onClick={() => onSelectBlock(block)}
        />
      ))}
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// Re-export math constants for tests
export const __testing = {
  DAY_START_HOUR: DEFAULT_DAY_START,
  DAY_END_HOUR: DEFAULT_DAY_END,
  HOUR_HEIGHT_PX,
};
