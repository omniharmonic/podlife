import type { ReactNode, HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Level = 1 | 2 | 3;

interface EditorialHeadingProps extends Omit<HTMLAttributes<HTMLHeadingElement>, 'children'> {
  level?: Level;
  eyebrow?: ReactNode;
  children: ReactNode;
  /** Italic accent. Off by default — we earned restraint. */
  italic?: boolean;
  className?: string;
}

/**
 * EditorialHeading — Instrument Serif heading with an optional eyebrow.
 * Upright is the default; italic is opt-in for deliberate emphasis.
 */
export function EditorialHeading({
  level = 1,
  eyebrow,
  italic = false,
  className,
  children,
  ...rest
}: EditorialHeadingProps) {
  const sizing =
    level === 1
      ? 'text-[2.6rem] sm:text-[3.4rem] leading-[1.04]'
      : level === 2
        ? 'text-3xl sm:text-[2.25rem] leading-[1.08]'
        : 'text-2xl sm:text-3xl leading-[1.1]';

  const headingClass = cn(
    'font-display text-ink-800 tracking-[-0.005em]',
    italic && 'italic',
    sizing,
    className,
  );

  const heading =
    level === 1 ? (
      <h1 className={headingClass} {...rest}>
        {children}
      </h1>
    ) : level === 2 ? (
      <h2 className={headingClass} {...rest}>
        {children}
      </h2>
    ) : (
      <h3 className={headingClass} {...rest}>
        {children}
      </h3>
    );

  return (
    <div className="flex flex-col gap-2.5">
      {eyebrow && <span className="eyebrow text-ink-500">{eyebrow}</span>}
      {heading}
    </div>
  );
}
