import { useEffect, useState } from 'react';
import {
  usePartnerPreferences,
  useUpdatePartnerPreferences,
} from '@/hooks/usePartners';
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Flourish } from '@/components/ui/Flourish';
import { useUiStore } from '@/stores/ui.store';
import { NaturalPreferenceInput } from '@/components/ai/NaturalPreferenceInput';

interface Props {
  partnershipId: string;
  partnerName: string;
}

interface FormState {
  needMinHours: number;
  needMinDateNights: number;
  needMinOvernights: number;
  prefIdealHours: number;
  prefDateNights: number;
  prefOvernights: number;
  prefDaytimeHangs: number;
}

const ZERO: FormState = {
  needMinHours: 0,
  needMinDateNights: 0,
  needMinOvernights: 0,
  prefIdealHours: 0,
  prefDateNights: 0,
  prefOvernights: 0,
  prefDaytimeHangs: 0,
};

/**
 * Editorial inline preferences editor — sliders, toggles, and a clear
 * prose summary of what the user is asking for.
 */
export function PartnerPreferencesEditor({ partnershipId, partnerName }: Props) {
  const prefs = usePartnerPreferences(partnershipId);
  const update = useUpdatePartnerPreferences(partnershipId);
  const showToast = useUiStore((s) => s.showToast);
  const [form, setForm] = useState<FormState>(ZERO);

  useEffect(() => {
    if (prefs.data) {
      setForm({
        needMinHours: prefs.data.needMinHours,
        needMinDateNights: prefs.data.needMinDateNights,
        needMinOvernights: prefs.data.needMinOvernights,
        prefIdealHours: prefs.data.prefIdealHours,
        prefDateNights: prefs.data.prefDateNights,
        prefOvernights: prefs.data.prefOvernights,
        prefDaytimeHangs: prefs.data.prefDaytimeHangs,
      });
    }
  }, [prefs.data]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave() {
    try {
      await update.mutateAsync(form);
      showToast('Preferences saved', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not save preferences',
        'error',
      );
    }
  }

  if (prefs.isLoading) {
    return (
      <p className="text-sm text-ink-500 italic">Loading preferences…</p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Cycle prose */}
      <section className="text-sm text-ink-600 leading-relaxed">
        <p className="font-display italic text-xl text-ink-800 mb-2"
           style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 460" }}>
          What is a cycle?
        </p>
        <p>
          A cycle is one round of planning — usually a week, but each pod
          chooses its own rhythm. The numbers below are <em>per cycle</em>.
        </p>
      </section>

      {/* AI: opt-in natural-language editor (renders nothing if AI off) */}
      <NaturalPreferenceInput
        partnershipId={partnershipId}
        partnerName={partnerName}
      />

      {/* Sentence summary */}
      <p className="text-base text-ink-700 italic leading-[1.7]">
        You'd love about{' '}
        <strong className="font-display not-italic text-ink-900"
                style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 600" }}>
          {form.prefIdealHours} hours
        </strong>{' '}
        with {partnerName} each cycle, including{' '}
        <strong className="font-display not-italic text-ink-900"
                style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 600" }}>
          {form.prefDateNights} date {form.prefDateNights === 1 ? 'night' : 'nights'}
        </strong>{' '}
        and{' '}
        <strong className="font-display not-italic text-ink-900"
                style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 600" }}>
          {form.prefOvernights} overnight{form.prefOvernights === 1 ? '' : 's'}
        </strong>
        .
      </p>

      <Flourish variant="rule" className="text-ink-300" />

      {/* Preferences */}
      <section>
        <h4 className="font-display italic text-xl text-ink-800 mb-1"
            style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 460" }}>
          What you'd love
        </h4>
        <p className="text-xs text-ink-500 italic mb-6">
          Soft targets — the optimizer maximizes how close you get.
        </p>
        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-8">
          <Slider
            label="Ideal hours"
            unit="per cycle"
            value={form.prefIdealHours}
            onChange={(v) => setField('prefIdealHours', v)}
            min={0}
            max={40}
            step={0.5}
          />
          <Slider
            label="Date nights"
            unit="per cycle"
            value={form.prefDateNights}
            onChange={(v) => setField('prefDateNights', Math.round(v))}
            min={0}
            max={7}
            step={1}
          />
          <Slider
            label="Overnights"
            unit="per cycle"
            value={form.prefOvernights}
            onChange={(v) => setField('prefOvernights', Math.round(v))}
            min={0}
            max={7}
            step={1}
          />
          <Slider
            label="Daytime hangs"
            unit="per cycle"
            value={form.prefDaytimeHangs}
            onChange={(v) => setField('prefDaytimeHangs', Math.round(v))}
            min={0}
            max={7}
            step={1}
          />
        </div>
        <div className="mt-6">
          <Toggle
            checked={form.prefOvernights > 0}
            onChange={(v) => setField('prefOvernights', v ? Math.max(1, form.prefOvernights) : 0)}
            label="I'd like overnights with this partner"
            description="Toggle off if overnights aren't part of this relationship right now."
          />
        </div>
      </section>

      <Flourish variant="rule" className="text-ink-300" />

      {/* Needs (hard minimums) */}
      <section>
        <h4 className="font-display italic text-xl text-ink-800 mb-1"
            style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 460" }}>
          What you need
        </h4>
        <p className="text-xs text-ink-500 italic mb-6">
          Hard minimums — non-negotiable for the optimizer.
        </p>
        <div className="grid sm:grid-cols-3 gap-x-10 gap-y-8">
          <Slider
            label="Min hours"
            unit="per cycle"
            value={form.needMinHours}
            onChange={(v) => setField('needMinHours', v)}
            min={0}
            max={Math.max(20, form.prefIdealHours)}
            step={0.5}
          />
          <Slider
            label="Min date nights"
            unit="per cycle"
            value={form.needMinDateNights}
            onChange={(v) => setField('needMinDateNights', Math.round(v))}
            min={0}
            max={Math.max(3, form.prefDateNights)}
            step={1}
          />
          <Slider
            label="Min overnights"
            unit="per cycle"
            value={form.needMinOvernights}
            onChange={(v) => setField('needMinOvernights', Math.round(v))}
            min={0}
            max={Math.max(3, form.prefOvernights)}
            step={1}
          />
        </div>
      </section>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} loading={update.isPending}>
          Save preferences
        </Button>
      </div>
    </div>
  );
}
