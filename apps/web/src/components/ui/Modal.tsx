import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Optional sticky footer area for actions. */
  footer?: ReactNode;
  /** When true, modal is full-screen on mobile (slides up). */
  fullOnMobile?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  fullOnMobile = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        className="absolute inset-0 bg-ink-800/35 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative bg-cream shadow-letter w-full sm:max-w-lg sm:mx-4 flex flex-col max-h-[92vh] sm:max-h-[88vh] border border-ink-100/60',
          fullOnMobile ? 'rounded-t-3xl sm:rounded-3xl' : 'rounded-3xl mx-4 mb-4',
          'animate-slide-up sm:animate-scale-in',
        )}
      >
        {title && (
          <header className="px-6 pt-6 pb-3 flex items-start justify-between gap-3 border-b border-ink-100/60">
            <h2
              id="modal-title"
              className="font-display text-2xl text-ink-800 leading-tight"
              style={{ fontVariationSettings: "'opsz' 48, 'SOFT' 30, 'wght' 480" }}
            >
              {title}
            </h2>
            <WaxSealCloseButton onClick={onClose} />
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="px-6 py-4 border-t border-ink-100/60 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pb-safe">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function WaxSealCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="shrink-0 group relative w-10 h-10 rounded-full bg-wine-500 text-cream shadow-seal flex items-center justify-center transition-transform duration-200 hover:rotate-12 hover:scale-105 active:scale-95"
    >
      <span
        className="absolute inset-0 rounded-full opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent 50%)',
        }}
        aria-hidden="true"
      />
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative"
        aria-hidden="true"
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}
