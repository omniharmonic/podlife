import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className, id, children, ...rest },
  ref,
) {
  const selectId = id ?? `s_${rest.name ?? Math.random().toString(36).slice(2, 8)}`;
  return (
    <label htmlFor={selectId} className="flex flex-col gap-1.5">
      {label && <span className="eyebrow text-ink-500">{label}</span>}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full bg-transparent text-ink-800',
            'border-0 border-b border-ink-300/70 pl-0 pr-7 pb-1.5 pt-1 text-base',
            'focus:outline-none focus:border-terracotta-500',
            'transition-colors appearance-none',
            error && 'border-wine-500 focus:border-wine-500',
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <svg
          className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {error ? (
        <span className="text-xs text-wine-500 font-mono">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-400 italic">{hint}</span>
      ) : null}
    </label>
  );
});
