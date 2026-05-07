import { cn } from '@/lib/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  description?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: ToggleProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:ring-offset-2',
          checked ? 'bg-terracotta-500' : 'bg-ink-200',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-cream shadow transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col gap-0.5 -mt-0.5">
          {label && (
            <span className="text-sm font-medium text-ink-700">{label}</span>
          )}
          {description && (
            <span className="text-xs text-ink-500 italic">{description}</span>
          )}
        </div>
      )}
    </label>
  );
}
