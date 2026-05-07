/**
 * NaturalPreferenceInput — opt-in "describe in your own words" preference
 * editor. Renders nothing when the AI feature flag is off.
 *
 * Flow:
 *   1. User types free text → clicks "Parse"
 *   2. Server returns { proposed, rationale, ambiguous, clarifyingQuestion }
 *   3. We render a confirmation card showing the proposed values as editable
 *      number inputs alongside the current ones
 *   4. "Confirm" applies the patch via the existing partner-prefs endpoint
 *      (same as the manual form), so server-side validation is identical.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useFeatures } from '@/hooks/useFeatures';
import { useUiStore } from '@/stores/ui.store';
import { ai, ApiError, type ParsePreferencesProposal } from '@/lib/api';

interface Props {
  partnershipId: string;
  partnerName?: string;
}

export function NaturalPreferenceInput({ partnershipId, partnerName }: Props) {
  const features = useFeatures();
  const showToast = useUiStore((s) => s.showToast);
  const qc = useQueryClient();

  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [proposed, setProposed] = useState<ParsePreferencesProposal | null>(null);
  const [rationale, setRationale] = useState<string>('');
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);

  // Hide entirely when AI is disabled on the server.
  if (!features.data?.ai) return null;

  async function onParse() {
    if (!input.trim()) return;
    setParsing(true);
    setClarifyingQuestion(null);
    try {
      const res = await ai.parsePreferences(partnershipId, input);
      setProposed(res.proposed);
      setRationale(res.rationale ?? '');
      if (res.ambiguous && res.clarifyingQuestion) {
        setClarifyingQuestion(res.clarifyingQuestion);
      }
      if (Object.keys(res.proposed).length === 0 && !res.clarifyingQuestion) {
        showToast(
          "I couldn't extract any preferences from that. Try a more specific description.",
          'info',
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        showToast('AI features are off on this server. Use the form below.', 'info');
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
    if (!proposed) return;
    setConfirming(true);
    try {
      await ai.confirmPreferences(partnershipId, proposed);
      showToast('Preferences updated', 'success');
      // Refresh the partner prefs / list queries so the form below re-loads.
      await qc.invalidateQueries({
        queryKey: ['partners', partnershipId, 'preferences'],
      });
      await qc.invalidateQueries({ queryKey: ['partners'] });
      // Reset.
      setInput('');
      setProposed(null);
      setRationale('');
      setClarifyingQuestion(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Couldn't apply changes",
        'error',
      );
    } finally {
      setConfirming(false);
    }
  }

  function setProposedField(key: keyof ParsePreferencesProposal, value: string) {
    if (!proposed) return;
    if (value === '') {
      const next = { ...proposed };
      delete next[key];
      setProposed(next);
      return;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    setProposed({ ...proposed, [key]: Math.max(0, num) });
  }

  return (
    <Card>
      <div className="mb-3">
        <h2 className="font-bold text-stone-800">Or describe in your own words</h2>
        <p className="text-xs text-stone-500">
          Tell us how you want to spend time
          {partnerName ? ` with ${partnerName}` : ''} and we'll fill in the form.
        </p>
      </div>

      <textarea
        className="w-full min-h-[88px] rounded-2xl border border-stone-200 px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 transition-colors resize-y"
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        placeholder="e.g. I'd love to see them about twice a week, mostly evenings, plus an overnight on Saturdays"
        maxLength={2000}
      />

      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onParse}
          loading={parsing}
          disabled={!input.trim()}
          type="button"
        >
          Parse
        </Button>
      </div>

      {clarifyingQuestion && (
        <div className="mt-3 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-900">
          <strong className="font-semibold">One question:</strong>{' '}
          {clarifyingQuestion}
        </div>
      )}

      {proposed && Object.keys(proposed).length > 0 && (
        <div className="mt-4 p-3 rounded-2xl bg-stone-50 border border-stone-100 flex flex-col gap-3">
          {rationale && (
            <p className="text-sm text-stone-600 italic">{rationale}</p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {(Object.entries(proposed) as Array<
              [keyof ParsePreferencesProposal, string | number | undefined]
            >)
              .filter(([k]) => k !== 'cadence')
              .map(([key, value]) => (
                <Input
                  key={key}
                  label={LABELS[key as keyof typeof LABELS] ?? String(key)}
                  type="number"
                  min={0}
                  value={value === undefined ? '' : String(value)}
                  onChange={(e) =>
                    setProposedField(
                      key as keyof ParsePreferencesProposal,
                      e.currentTarget.value,
                    )
                  }
                />
              ))}
            {proposed.cadence && (
              <div className="text-xs text-stone-500 self-end">
                Cadence: <strong>{proposed.cadence}</strong>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setProposed(null);
                setRationale('');
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="button"
              loading={confirming}
              onClick={onConfirm}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const LABELS: Record<string, string> = {
  needMinHours: 'Min hours / cycle',
  needMinDateNights: 'Min date nights',
  needMinOvernights: 'Min overnights',
  prefIdealHours: 'Ideal hours / cycle',
  prefDateNights: 'Date nights',
  prefOvernights: 'Overnights',
  prefDaytimeHangs: 'Daytime hangs',
};
