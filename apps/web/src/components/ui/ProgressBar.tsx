import { cn } from '@/lib/cn';

interface ProgressBarProps {
  pct: number;
  color?: string;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({
  pct,
  color = '#C25B3F',
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || showValue) && (
        <div className="flex justify-between items-baseline">
          {label && <span className="eyebrow text-ink-500">{label}</span>}
          {showValue && (
            <span className="font-mono text-xs text-ink-500 tabular-nums">
              {Math.round(clamped)}%
            </span>
          )}
        </div>
      )}
      <div className="h-[3px] bg-ink-100 overflow-hidden">
        <div
          className="h-full transition-[width] duration-700 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
