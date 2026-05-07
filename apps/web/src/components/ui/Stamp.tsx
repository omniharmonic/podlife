import { cn } from '@/lib/cn';

interface StampProps {
  children: React.ReactNode;
  tone?: 'ink' | 'terracotta' | 'sage' | 'wine';
  rotate?: number;
  className?: string;
}

const TONES = {
  ink: 'text-ink-700',
  terracotta: 'text-terracotta-600',
  sage: 'text-sage-700',
  wine: 'text-wine-600',
};

/**
 * Stamp — a thicker rectangular stamp for "WEEK 19" / "DRAFT" / "PROPOSED" labels.
 * Different look from <Postmark> (which is dashed and date-shaped).
 */
export function Stamp({ children, tone = 'ink', rotate = -1.5, className }: StampProps) {
  return (
    <span
      className={cn(
        'inline-block px-3 py-1 rounded-[3px]',
        'border-2 border-current',
        'font-mono uppercase tracking-[0.2em] text-[0.7rem] font-medium',
        TONES[tone],
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {children}
    </span>
  );
}
