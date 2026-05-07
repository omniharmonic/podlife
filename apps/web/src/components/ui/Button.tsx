import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * Editorial Button.
 *
 * - primary: letterpress imprint — deeper terracotta, thin ink shadow,
 *   restrained downward press on active.
 * - secondary: outlined sage — thin ink-tone border, no fill.
 * - ghost: ink underline that animates on hover (book-cover affordance).
 * - danger: wine.
 */
const VARIANTS: Record<Variant, string> = {
  primary: cn(
    'bg-terracotta-500 text-cream font-medium',
    'shadow-[inset_0_-2px_0_rgba(45,20,12,0.18),0_1px_0_rgba(45,20,12,0.08),0_4px_14px_-6px_rgba(123,45,38,0.45)]',
    'hover:bg-terracotta-600 active:translate-y-[1px] active:shadow-[inset_0_-1px_0_rgba(45,20,12,0.2),0_1px_0_rgba(45,20,12,0.1)]',
    'disabled:bg-terracotta-200 disabled:shadow-none disabled:text-cream/80',
  ),
  secondary: cn(
    'bg-transparent text-sage-700 border border-sage-500/70',
    'hover:bg-sage-50 hover:border-sage-600',
    'active:translate-y-[1px]',
    'disabled:text-sage-300 disabled:border-sage-200',
  ),
  ghost: cn(
    'bg-transparent text-ink-700',
    'after:content-[""] after:block after:h-[1px] after:bg-ink-700',
    'after:scale-x-0 after:origin-left after:transition-transform after:duration-200',
    'hover:after:scale-x-100',
    'disabled:text-ink-300 disabled:after:hidden',
  ),
  danger: cn(
    'bg-wine-500 text-cream',
    'shadow-[inset_0_-2px_0_rgba(20,4,2,0.18),0_1px_0_rgba(20,4,2,0.08)]',
    'hover:bg-wine-600 active:translate-y-[1px]',
    'disabled:bg-wine-200',
  ),
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm rounded-full',
  md: 'h-11 px-6 text-[0.95rem] rounded-full',
  lg: 'h-14 px-8 text-base rounded-full',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    leftIcon,
    rightIcon,
    type = 'button',
    ...rest
  },
  ref,
) {
  // Ghost variant uses a different layout because the underline is a flex-broken pseudo-element
  if (variant === 'ghost') {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(
          'inline-flex flex-col items-center justify-center gap-0.5 transition-colors duration-150',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-parchment',
          'disabled:cursor-not-allowed',
          SIZES[size].replace('rounded-full', ''),
          'rounded-md',
          'text-ink-700 hover:text-ink-900 disabled:text-ink-300',
          'group',
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        <span className="inline-flex items-center gap-2">
          {loading ? (
            <span
              className="inline-block w-3.5 h-3.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
          ) : leftIcon ? (
            <span aria-hidden="true">{leftIcon}</span>
          ) : null}
          <span>{children}</span>
          {!loading && rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
        </span>
        <span className="block h-px w-full bg-current scale-x-0 origin-left transition-transform duration-200 group-hover:scale-x-100 group-disabled:hidden" />
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-parchment',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
      ) : leftIcon ? (
        <span aria-hidden="true">{leftIcon}</span>
      ) : null}
      <span>{children}</span>
      {!loading && rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
    </button>
  );
});
