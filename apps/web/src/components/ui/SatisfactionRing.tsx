import { cn } from '@/lib/cn';

interface SatisfactionRingProps {
  /** 0–100 */
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  /** When true, hides percentage text and label (icon only). */
  compact?: boolean;
  className?: string;
}

/**
 * Circular ring — thinner stroke than typical, ink-on-cream colors,
 * percent set in big italic Fraunces. Animates stroke-dashoffset on mount.
 */
export function SatisfactionRing({
  pct,
  size = 64,
  strokeWidth = 2,
  color = '#C25B3F',
  label,
  compact = false,
  className,
}: SatisfactionRingProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className={cn('flex flex-col items-center gap-1.5', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          aria-hidden={compact ? 'true' : undefined}
          role={compact ? undefined : 'img'}
          aria-label={
            compact
              ? undefined
              : `Satisfaction ${Math.round(clamped)} percent${label ? ` for ${label}` : ''}`
          }
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(27, 24, 20, 0.12)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 700ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          />
        </svg>
        {!compact && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="font-display text-ink-800 tabular-nums leading-none"
              style={{ fontSize: Math.max(14, Math.round(size * 0.32)) }}
            >
              {Math.round(clamped)}
              <span
                className="text-ink-400"
                style={{ fontSize: Math.max(9, Math.round(size * 0.18)) }}
              >
                %
              </span>
            </span>
          </div>
        )}
      </div>
      {label && !compact && (
        <span className="text-[10.5px] text-ink-500 text-center font-medium tracking-[0.04em] max-w-full truncate">
          {label}
        </span>
      )}
    </div>
  );
}
