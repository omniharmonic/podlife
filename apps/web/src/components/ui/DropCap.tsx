import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface DropCapProps {
  children: ReactNode;
  className?: string;
}

/**
 * DropCap — render prose with a 3-line oversized italic Fraunces opening capital.
 * Wraps the entire paragraph; the CSS `.drop-cap` class targets `::first-letter`.
 */
export function DropCap({ children, className }: DropCapProps) {
  return (
    <p
      className={cn(
        'drop-cap text-[1.05rem] leading-[1.7] text-ink-700',
        className,
      )}
    >
      {children}
    </p>
  );
}
