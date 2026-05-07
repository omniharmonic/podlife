import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'proposed' | 'accepted' | 'locked' | 'declined' | 'neutral' | 'warn';

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const TONES: Record<Tone, string> = {
  proposed: 'bg-gold-100 text-gold-700 border border-gold-300/60',
  accepted: 'bg-sage-100 text-sage-700 border border-sage-300/60',
  locked: 'bg-wine-100 text-wine-700 border border-wine-300/60',
  declined: 'bg-rose-100 text-rose-700 border border-rose-300/60',
  neutral: 'bg-ink-50 text-ink-600 border border-ink-200/60',
  warn: 'bg-rose-100 text-rose-700 border border-rose-300/60',
};

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-[2px] rounded-full',
        'font-mono uppercase text-[0.65rem] tracking-[0.14em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
