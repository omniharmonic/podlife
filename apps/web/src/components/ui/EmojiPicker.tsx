import { useEffect, useRef, useState } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

interface Props {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
}

/**
 * Button that displays the current emoji and opens a full emoji-mart picker
 * in a popover on click. Closes on outside click or after a selection. The
 * picker covers every emoji in the standard data set with search, so the
 * user is never limited to a hand-picked grid.
 *
 * Note on the peer-dep warning: @emoji-mart/react declares React 16-18 as
 * its peer range, but the component only uses the public render/effect API
 * and works on React 19 in practice. Watch for breakage on emoji-mart
 * upgrades.
 */
export function EmojiPicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      {label && (
        <span className="eyebrow text-ink-500 mb-2 block">{label}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose emoji"
        className="w-14 h-14 rounded-xl border border-ink-200 bg-cream hover:bg-ink-50 flex items-center justify-center text-2xl transition-colors"
      >
        {value}
      </button>
      {open && (
        <div className="absolute z-50 mt-2 shadow-letter rounded-lg overflow-hidden">
          <Picker
            data={data}
            theme="light"
            previewPosition="none"
            skinTonePosition="none"
            onEmojiSelect={(e: { native: string }) => {
              onChange(e.native);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
