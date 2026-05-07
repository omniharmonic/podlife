/**
 * ExplainScheduleButton — small "Why?" button that opens a modal asking
 * the LLM to explain the user's current schedule. Renders nothing when
 * the AI feature flag is off.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useFeatures } from '@/hooks/useFeatures';
import { useUiStore } from '@/stores/ui.store';
import { ai, ApiError, type ExplainScheduleResponse } from '@/lib/api';

interface Props {
  /** Optional: explain a specific cycle. Defaults to the latest. */
  cycleId?: string;
  /** Prefilled prompt for the question textarea. */
  defaultQuestion?: string;
  /** Visual size — defaults to 'sm'. */
  size?: 'sm' | 'md';
  /** Optional className override on the trigger button. */
  className?: string;
}

export function ExplainScheduleButton({
  cycleId,
  defaultQuestion = 'Why does this schedule look the way it does?',
  size = 'sm',
  className,
}: Props) {
  const features = useFeatures();
  const showToast = useUiStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(defaultQuestion);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ExplainScheduleResponse | null>(null);

  if (!features.data?.ai) return null;

  async function onAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setResponse(null);
    try {
      const r = await ai.explainSchedule(question, cycleId);
      setResponse(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        showToast('AI features are off on this server.', 'info');
        setOpen(false);
      } else if (err instanceof ApiError && err.status === 404) {
        showToast(
          'No schedule yet — run a scheduling cycle first.',
          'info',
        );
      } else {
        showToast(
          err instanceof Error ? err.message : "Couldn't explain — try again",
          'error',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant="ghost"
        onClick={() => setOpen(true)}
        className={className}
        type="button"
      >
        Why?
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResponse(null);
        }}
        title="Why does this schedule look this way?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              type="button"
            >
              Close
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={onAsk}
              disabled={!question.trim()}
              type="button"
            >
              Ask
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-stone-500">
            Ask anything about your proposed schedule — the assistant only
            sees your blocks and satisfaction, never anyone else's.
          </p>
          <textarea
            className="w-full min-h-[80px] rounded-2xl border border-stone-200 px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 transition-colors resize-y"
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            placeholder="e.g. Why didn't I get an overnight this week?"
            maxLength={1000}
          />

          {response && (
            <div className="mt-2 p-4 rounded-2xl bg-amber-50/60 border border-amber-100 flex flex-col gap-3">
              <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-wrap">
                {response.explanation}
              </p>
              {response.suggestions.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-500 font-semibold mb-1">
                    You could try
                  </p>
                  <ul className="text-sm text-stone-700 list-disc list-inside space-y-1">
                    {response.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
