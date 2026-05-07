import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftAdornment?: ReactNode;
}

/**
 * Editorial Input — replaces busy box-shadow borders with a single 1px ink
 * underline. Focus deepens to terracotta. Numeric inputs in metadata use the
 * mono font automatically.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftAdornment, className, id, type, ...rest },
  ref,
) {
  const inputId = id ?? `i_${rest.name ?? Math.random().toString(36).slice(2, 8)}`;
  const isMonoish = type === 'time' || type === 'date' || type === 'datetime-local';
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      {label && (
        <span className="eyebrow text-ink-500">{label}</span>
      )}
      <div className="relative flex items-center">
        {leftAdornment && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-300">
            {leftAdornment}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          className={cn(
            'w-full bg-transparent text-ink-800 placeholder:text-ink-300',
            'border-0 border-b border-ink-300/70 px-0 pb-1.5 pt-1 text-base',
            'focus:outline-none focus:border-terracotta-500 focus:ring-0',
            'transition-colors duration-150',
            isMonoish && 'font-mono tracking-wide',
            leftAdornment ? 'pl-7' : null,
            error && 'border-wine-500 focus:border-wine-500',
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <span className="text-xs text-wine-500 font-mono">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-400 italic">{hint}</span>
      ) : null}
    </label>
  );
});
