import type { ReactNode } from 'react';
import { Flourish } from './Flourish';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Optional custom illustration. Defaults to a fineline flourish. */
  illustration?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  illustration,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="mb-6 opacity-80">
        {illustration ?? <Flourish variant="laurel" className="w-32 h-12 text-ink-400" />}
      </div>
      <h3 className="font-display italic text-2xl text-ink-800 mb-2"
          style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 60, 'wght' 420" }}>
        {title}
      </h3>
      {description && (
        <p className="text-sm text-ink-500 max-w-sm mb-6 leading-relaxed">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
