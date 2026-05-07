import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/cn';

interface PostmarkProps {
  /** A date or ISO string to stamp. If omitted, the children fill the stamp. */
  date?: Date | string;
  children?: React.ReactNode;
  className?: string;
  rotate?: number;
}

/**
 * Postmark — a small stamped-look date badge in DM Mono. Optionally rotated
 * to feel hand-applied.
 */
export function Postmark({ date, children, className, rotate = -2 }: PostmarkProps) {
  let content: React.ReactNode = children;
  if (date && !children) {
    const d = typeof date === 'string' ? parseISO(date) : date;
    const m = format(d, 'MMM').toUpperCase();
    const day = format(d, 'd');
    const year = format(d, 'yyyy');
    content = (
      <>
        <span>{m}</span>
        <span className="opacity-50">·</span>
        <span>{day}</span>
        <span className="opacity-50">·</span>
        <span>{year}</span>
      </>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-md',
        'font-mono uppercase tracking-[0.18em] text-[0.65rem]',
        'border border-dashed border-current text-ink-500',
        'bg-cream/70',
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {content}
    </span>
  );
}
