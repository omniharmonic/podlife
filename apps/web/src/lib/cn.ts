/** Lightweight class-name combiner — like clsx but tiny. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
