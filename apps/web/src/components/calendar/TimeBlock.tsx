import type { TimeBlock as TimeBlockType } from '@pod-life/shared';
import { parseISO } from 'date-fns';
import { cn } from '@/lib/cn';
import { formatTimeRange } from '@/lib/dates';

interface TimeBlockProps {
  block: TimeBlockType;
  /** Color (hex) for this block based on partner/pod (used as accent stripe). */
  color: string;
  dayStartHour: number;
  hourHeight: number;
  contextLabel?: string;
  onClick?: () => void;
}

function eventTypePalette(eventType: string): { stripe: string; tint: string } {
  const t = eventType.toLowerCase();
  if (t.includes('date')) return { stripe: '#7B2D26', tint: 'rgba(123,45,38,0.07)' };
  if (t.includes('overnight')) return { stripe: '#D4AF6F', tint: 'rgba(212,175,111,0.10)' };
  if (t.includes('daytime') || t.includes('hang') || t.includes('day')) {
    return { stripe: '#7A9A85', tint: 'rgba(122,154,133,0.10)' };
  }
  return { stripe: '#C25B3F', tint: 'rgba(194,91,63,0.08)' };
}

export function TimeBlock({
  block,
  color,
  dayStartHour,
  hourHeight,
  contextLabel,
  onClick,
}: TimeBlockProps) {
  const start = parseISO(block.startTime);
  const end = parseISO(block.endTime);

  const startHours = start.getHours() + start.getMinutes() / 60;
  const endHours = end.getHours() + end.getMinutes() / 60;

  const top = Math.max(0, (startHours - dayStartHour) * hourHeight);
  const height = Math.max(28, (endHours - startHours) * hourHeight);

  const isProposed = block.status === 'proposed';
  const palette = eventTypePalette(block.eventType);
  const stripe = color || palette.stripe;
  const acceptedByMe = block.myResponse === 'accepted';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute left-1 right-1 rounded-lg text-left overflow-hidden',
        'transition-all hover:-translate-y-[1px] hover:shadow-paper focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
        'bg-cream border',
        isProposed ? 'border-dashed' : 'border-solid',
      )}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        backgroundColor: palette.tint,
        borderColor: isProposed ? `${stripe}AA` : `${stripe}55`,
      }}
      aria-label={`${block.eventType} ${formatTimeRange(start, end)}${
        contextLabel ? ` with ${contextLabel}` : ''
      } — ${block.status}`}
    >
      {/* Accent stripe */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: stripe }}
      />
      {/* Quiet status dot for accepted/locked blocks */}
      {(block.status === 'accepted' || block.status === 'locked' || acceptedByMe) && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: stripe }}
          title={
            block.status === 'locked'
              ? 'Locked'
              : block.status === 'accepted'
                ? 'Accepted'
                : 'You accepted'
          }
        />
      )}
      <div className="pl-3 pr-3 pt-1.5 pb-1">
        <div className="font-display text-[0.95rem] leading-tight text-ink-800 truncate">
          {block.eventLabel ?? block.eventType}
        </div>
        {contextLabel && height > 36 && (
          <div className="text-[10px] uppercase tracking-[0.12em] font-medium text-ink-500 truncate mt-0.5">
            {contextLabel}
          </div>
        )}
        {height > 56 && (
          <div className="text-[10px] text-ink-500 mt-0.5 tabular-nums">
            {formatTimeRange(start, end)}
          </div>
        )}
      </div>
    </button>
  );
}
