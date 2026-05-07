import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type CardAs = 'plain' | 'letter' | 'dashed';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Visual style:
   * - plain: cream paper card, soft warm-paper shadow.
   * - letter: like a folded letter — slight tilt at -0.4deg, deckle edge.
   * - dashed: thin dashed ink border, no shadow (e.g. notes/empty states).
   */
  as?: CardAs;
}

const PAD = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

const VARIANTS: Record<CardAs, string> = {
  plain: 'bg-cream shadow-paper border border-ink-100/40 rounded-2xl',
  letter:
    'bg-cream shadow-letter border border-ink-100/50 rounded-[14px] -rotate-[0.4deg] hover:rotate-0 transition-transform duration-300',
  dashed:
    'bg-transparent border border-dashed border-ink-200 rounded-2xl',
};

export function Card({
  children,
  interactive = false,
  padding = 'md',
  as = 'plain',
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'relative',
        VARIANTS[as],
        PAD[padding],
        interactive &&
          'transition-all hover:shadow-letter hover:-translate-y-0.5 cursor-pointer active:translate-y-0',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
