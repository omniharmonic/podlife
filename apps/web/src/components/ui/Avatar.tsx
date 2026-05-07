import { useMemo } from 'react';
import { PARTNER_COLORS } from '@pod-life/shared';
import { cn } from '@/lib/cn';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  /** Override background color. */
  color?: string;
  className?: string;
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PARTNER_COLORS.length;
  return PARTNER_COLORS[idx]!;
}

export function Avatar({ name, src, size = 40, color, className }: AvatarProps) {
  const initials = useMemo(() => initialsFor(name), [name]);
  const bg = color ?? colorFor(name);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('rounded-full object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center text-cream shrink-0 font-display',
        'shadow-[inset_0_-2px_4px_rgba(20,15,10,0.12)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: Math.max(13, Math.round(size * 0.44)),
        letterSpacing: '0.01em',
      }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
