import { cn } from '@/lib/cn';

interface LogoProps {
  size?: number;
  /** Show the wordmark next to the symbol. */
  withWordmark?: boolean;
  className?: string;
}

/**
 * Pod Life logo — three overlapping pebbles (sage, gold, rose) under a
 * delicate vine. Used in the AppShell header and on auth/welcome screens.
 */
export function Logo({ size = 32, withWordmark = false, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <img
        src="/podlife_logo_alpha.png"
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="block object-contain"
        aria-hidden="true"
      />
      {withWordmark && (
        <span
          className="font-display text-ink-800 leading-none"
          style={{ fontSize: Math.round(size * 0.62) }}
        >
          Pod Life
        </span>
      )}
    </span>
  );
}
