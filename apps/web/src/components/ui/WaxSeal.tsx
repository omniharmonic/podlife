import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

type Variant = 'proposed' | 'accepted' | 'locked';
type Size = 'sm' | 'md' | 'lg';

interface WaxSealProps {
  variant?: Variant;
  size?: Size;
  /** Short letter shown in the seal center (defaults to first letter of variant). */
  letter?: string;
  className?: string;
}

const COLORS: Record<Variant, { bg: string; ink: string }> = {
  proposed: { bg: '#D4AF6F', ink: '#54250F' },
  accepted: { bg: '#7A9A85', ink: '#22302A' },
  locked: { bg: '#7B2D26', ink: '#FFFCF6' },
};

const SIZES: Record<Size, number> = {
  sm: 28,
  md: 40,
  lg: 56,
};

/**
 * WaxSeal — a circular pressed-wax badge for "proposed", "accepted", "locked".
 * Rotates slightly on hover via framer-motion.
 */
export function WaxSeal({
  variant = 'accepted',
  size = 'md',
  letter,
  className,
}: WaxSealProps) {
  const px = SIZES[size];
  const colors = COLORS[variant];
  const initial = letter ?? variant.charAt(0).toUpperCase();
  const labelText = `${variant} seal`;

  return (
    <motion.span
      whileHover={{ rotate: 8, scale: 1.04 }}
      transition={{ type: 'spring', stiffness: 240, damping: 18 }}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full select-none',
        className,
      )}
      style={{
        width: px,
        height: px,
        backgroundColor: colors.bg,
        color: colors.ink,
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.08), 0 4px 12px -4px rgba(60,30,20,0.45), inset 0 -3px 6px rgba(0,0,0,0.18), inset 0 2px 5px rgba(255,255,255,0.18)',
      }}
      role="img"
      aria-label={labelText}
    >
      {/* Notched edge — small offset stamps to suggest pressed wax */}
      <span
        aria-hidden="true"
        className="absolute inset-[3px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), transparent 55%)',
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          backgroundImage: `repeating-conic-gradient(from 0deg, transparent 0deg 28deg, rgba(0,0,0,0.06) 28deg 30deg)`,
        }}
      />
      <span
        className="relative font-display italic font-bold leading-none"
        style={{
          fontSize: Math.max(11, Math.round(px * 0.42)),
          fontVariationSettings: "'opsz' 96, 'SOFT' 50, 'wght' 600",
        }}
      >
        {initial}
      </span>
    </motion.span>
  );
}
