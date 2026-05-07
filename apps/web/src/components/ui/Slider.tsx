import { useId } from 'react';
import { cn } from '@/lib/cn';

interface SliderProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** Suffix shown next to the value (e.g. "hours / week"). */
  unit?: string;
  /** Optional human-readable hint below. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Slider — a beautiful range input with a custom thumb (a small printed dot)
 * and a thin ink track. The current value is set in italic Fraunces, big and
 * present, to feel like a stamped numeral on a page.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 20,
  step = 0.5,
  label,
  unit,
  hint,
  disabled = false,
  className,
}: SliderProps) {
  const id = useId();
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <label htmlFor={id} className="eyebrow text-ink-500">
          {label}
        </label>
      )}
      <div className="flex items-baseline gap-3">
        <span
          className="font-display italic text-ink-800 tabular-nums leading-none"
          style={{
            fontSize: '2rem',
            fontVariationSettings: "'opsz' 72, 'SOFT' 60, 'wght' 460",
          }}
        >
          {Number.isInteger(value) ? value : value.toFixed(1)}
        </span>
        {unit && <span className="text-sm text-ink-500 italic">{unit}</span>}
      </div>
      <div className="relative h-6 flex items-center">
        {/* Track */}
        <div className="absolute inset-x-0 h-[2px] bg-ink-200/70 rounded-full" />
        {/* Filled track */}
        <div
          className="absolute left-0 h-[2px] bg-terracotta-500 rounded-full"
          style={{ width: `${pct}%` }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          className={cn(
            'relative w-full h-6 bg-transparent appearance-none cursor-pointer',
            // WebKit / Chromium thumb
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4',
            '[&::-webkit-slider-thumb]:rounded-full',
            '[&::-webkit-slider-thumb]:bg-ink-800',
            '[&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(20,15,10,0.35)]',
            '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ink-900',
            '[&::-webkit-slider-thumb]:transition-transform',
            'hover:[&::-webkit-slider-thumb]:scale-110',
            // Firefox thumb
            '[&::-moz-range-thumb]:appearance-none',
            '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4',
            '[&::-moz-range-thumb]:rounded-full',
            '[&::-moz-range-thumb]:bg-ink-800',
            '[&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-ink-900',
            'focus:outline-none focus-visible:[&::-webkit-slider-thumb]:ring-2',
            'focus-visible:[&::-webkit-slider-thumb]:ring-terracotta-400',
          )}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono uppercase tracking-wider text-ink-400">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {hint && <p className="text-xs text-ink-500 italic">{hint}</p>}
    </div>
  );
}
