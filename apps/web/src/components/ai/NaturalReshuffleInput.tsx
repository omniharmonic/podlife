/**
 * NaturalReshuffleInput — a textarea where the user describes what needs
 * to shift in plain language. The LLM picks a candidate block; the user
 * confirms before we trigger a reshuffle cycle.
 *
 * Renders nothing when the AI feature flag is off.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useFeatures } from '@/hooks/useFeatures';
import { useUiStore } from '@/stores/ui.store';
import { ai, ApiError, type ParseReshuffleResponse } from '@/lib/api';

export function NaturalReshuffleInput() {
  const features = useFeatures();
  const showToast = useUiStore((s) => s.showToast);
  const qc = useQueryClient();

  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [parsed, setParsed] = useState<ParseReshuffleResponse | null>(null);

  if (!features.data?.ai) return null;

  async function onParse() {
    if (!input.trim()) return;
    setParsing(true);
    try {
      const res = await ai.parseReshuffle(input);
      setParsed(res);
      if (!res.candidateBlock) {
        showToast(
          res.clarifyingQuestion ??
            "I couldn't figure out which block to move. Try naming the day or partner.",
          'info',
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        showToast('AI features are off on this server.', 'info');
      } else {
        showToast(
          err instanceof Error ? err.message : "Couldn't parse — try again",
          'error',
        );
      }
    } finally {
      setParsing(false);
    }
  }

  async function onConfirm() {
    if (!parsed?.blockId) return;
    setConfirming(true);
    try {
      await ai.confirmReshuffle({
        blockId: parsed.blockId,
        reason: parsed.reason || input.slice(0, 200),
        ...(parsed.preferredAlternative
          ? { preferredAlternative: parsed.preferredAlternative }
          : {}),
      });
      showToast('Reshuffle started — new proposals will appear shortly.', 'success');
      await qc.invalidateQueries({ queryKey: ['proposals'] });
      setInput('');
      setParsed(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Couldn't reshuffle — try again",
        'error',
      );
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Card>
      <div className="mb-3">
        <h2 className="font-bold text-stone-800">Need to shift something?</h2>
        <p className="text-xs text-stone-500">
          Say what changed — we'll find the block and reschedule it.
        </p>
      </div>

      <textarea
        className="w-full min-h-[72px] rounded-2xl border border-stone-200 px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 transition-colors resize-y"
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        placeholder="e.g. I can't do Tuesday evening anymore — can we move it to later in the week?"
        maxLength={2000}
      />
      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          variant="ghost"
          loading={parsing}
          disabled={!input.trim()}
          onClick={onParse}
          type="button"
        >
          Find block
        </Button>
      </div>

      {parsed?.candidateBlock && (
        <div className="mt-3 p-3 rounded-2xl bg-stone-50 border border-stone-100 flex flex-col gap-2">
          <p className="text-sm text-stone-800">
            <span className="font-semibold">{parsed.candidateBlock.eventType}</span>
            {parsed.candidateBlock.partnerName
              ? ` with ${parsed.candidateBlock.partnerName}`
              : ''}
            {' on '}
            <time>{new Date(parsed.candidateBlock.start).toLocaleString()}</time>
          </p>
          {parsed.reason && (
            <p className="text-xs text-stone-500 italic">{parsed.reason}</p>
          )}
          {parsed.confidence === 'low' && parsed.clarifyingQuestion && (
            <p className="text-xs text-amber-700">{parsed.clarifyingQuestion}</p>
          )}
          <div className="flex justify-end gap-2 mt-1">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setParsed(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="button"
              loading={confirming}
              onClick={onConfirm}
            >
              Reshuffle this
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
