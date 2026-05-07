import { cn } from '@/lib/cn';

type Variant = 'rule' | 'laurel' | 'ornament';

interface FlourishProps {
  variant?: Variant;
  className?: string;
}

/**
 * Fineline SVG separator with a hand-drawn feel. Three variants:
 *  - rule: a thin centered horizontal line with a small diamond knot
 *  - laurel: a delicate two-leaf curl (used as a bookplate flourish)
 *  - ornament: a tiny printer's ornament (asterisk-like)
 */
export function Flourish({ variant = 'rule', className }: FlourishProps) {
  if (variant === 'laurel') {
    return (
      <svg
        viewBox="0 0 160 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('text-ink-400', className)}
        aria-hidden="true"
      >
        <path d="M2 18 Q 30 4, 60 18 T 100 18 T 158 18" />
        <path d="M40 14 Q 44 8, 50 12" />
        <path d="M55 22 Q 60 28, 66 22" />
        <path d="M100 14 Q 104 8, 110 12" />
        <path d="M115 22 Q 120 28, 126 22" />
        <circle cx="80" cy="18" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  if (variant === 'ornament') {
    return (
      <svg
        viewBox="0 0 40 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        className={cn('text-ink-400', className)}
        aria-hidden="true"
      >
        <path d="M20 4 v16" />
        <path d="M12 12 h16" />
        <path d="M14 6 l12 12" />
        <path d="M14 18 l12 -12" />
        <circle cx="20" cy="12" r="1.6" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 200 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      className={cn('text-ink-400 w-full h-3', className)}
      aria-hidden="true"
    >
      <path d="M2 6 Q 30 4, 92 6" />
      <path d="M108 6 Q 170 4, 198 6" />
      <path d="M100 2 l4 4 l-4 4 l-4 -4 z" fill="currentColor" stroke="none" />
    </svg>
  );
}
