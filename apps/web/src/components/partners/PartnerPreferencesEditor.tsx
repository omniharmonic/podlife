import { useEffect, useState } from 'react';
import type { RelationshipType, SchedulingCadence } from '@pod-life/shared';
import {
  useAcceptCadence,
  useDeclineCadence,
  usePartnerPreferences,
  useProposeCadence,
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
  /** When 'friendship', overnight + date-night fields are hidden. */
  relationshipType?: RelationshipType;
  /** Agreed cadence for this partnership. */
  cadence?: SchedulingCadence;
  /** Pending cadence proposal (null when none). */
  pendingCadence?: SchedulingCadence | null;
  /**
   * Whether the pending proposal was made by the current viewer.
   *  - null when there is no pending proposal
   *  - true when the viewer proposed (show "waiting on partnerName")
   *  - false when the other party proposed (show accept/decline banner)
   */
  pendingProposedByMe?: boolean | null;
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
export function PartnerPreferencesEditor({
  partnershipId,
  partnerName,
  relationshipType = 'partnership',
  cadence = 'weekly',
  pendingCadence = null,
  pendingProposedByMe = null,
}: Props) {
  const prefs = usePartnerPreferences(partnershipId);
  const update = useUpdatePartnerPreferences(partnershipId);
  const proposeCadenceMut = useProposeCadence(partnershipId);
  const acceptCadenceMut = useAcceptCadence(partnershipId);
  const declineCadenceMut = useDeclineCadence(partnershipId);
  const showToast = useUiStore((s) => s.showToast);
  const [form, setForm] = useState<FormState>(ZERO);
  const isFriendship = relationshipType === 'friendship';

  async function onProposeCadence(next: SchedulingCadence) {
    if (next === cadence && pendingCadence === null) return; // no-op
    try {
      const res = await proposeCadenceMut.mutateAsync(next);
      if (next === cadence) {
        showToast('Proposal withdrawn', 'success');
      } else {
        showToast(`Proposed ${next} · waiting for ${partnerName}`, 'success');
      }
      void res;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not propose', 'error');
    }
  }
  async function onAcceptCadence() {
    try {
      await acceptCadenceMut.mutateAsync();
      showToast('Cadence accepted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not accept', 'error');
    }
  }
  async function onDeclineCadence() {
    try {
      await declineCadenceMut.mutateAsync();
      showToast('Proposal declined', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not decline', 'error');
    }
  }

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
    // In friendship mode the date-night / overnight sliders are hidden but
    // their values still live in form state. Zero them on save so the
    // optimizer doesn't try to schedule date nights or overnights for a
    // platonic relationship.
    const payload: FormState = isFriendship
      ? {
          ...form,
          needMinDateNights: 0,
          needMinOvernights: 0,
          prefDateNights: 0,
          prefOvernights: 0,
        }
      : form;
    try {
      await update.mutateAsync(payload);
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
      {/* Cycle prose + cadence picker */}
      <section className="text-sm text-ink-600 leading-relaxed">
        <p className="font-display italic text-xl text-ink-800 mb-2"
           style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 460" }}>
          What is a cycle?
        </p>
        <p className="mb-5">
          A cycle is one round of planning. You and {partnerName} agree on
          how often this relationship's schedule resets. The numbers below
          are <em>per cycle</em>.
        </p>

        <CadencePicker
          current={cadence}
          pending={pendingCadence}
          pendingByMe={pendingProposedByMe}
          partnerName={partnerName}
          onPropose={onProposeCadence}
          onAccept={onAcceptCadence}
          onDecline={onDeclineCadence}
          proposing={proposeCadenceMut.isPending}
          accepting={acceptCadenceMut.isPending}
          declining={declineCadenceMut.isPending}
        />
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
        with {partnerName} each cycle
        {isFriendship ? (
          '.'
        ) : (
          <>
            , including{' '}
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
          </>
        )}
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
          {!isFriendship && (
            <Slider
              label="Date nights"
              unit="per cycle"
              value={form.prefDateNights}
              onChange={(v) => setField('prefDateNights', Math.round(v))}
              min={0}
              max={7}
              step={1}
            />
          )}
          {!isFriendship && (
            <Slider
              label="Overnights"
              unit="per cycle"
              value={form.prefOvernights}
              onChange={(v) => setField('prefOvernights', Math.round(v))}
              min={0}
              max={7}
              step={1}
            />
          )}
          <Slider
            label={isFriendship ? 'Hangouts' : 'Daytime hangs'}
            unit="per cycle"
            value={form.prefDaytimeHangs}
            onChange={(v) => setField('prefDaytimeHangs', Math.round(v))}
            min={0}
            max={7}
            step={1}
          />
        </div>
        {!isFriendship && (
          <div className="mt-6">
            <Toggle
              checked={form.prefOvernights > 0}
              onChange={(v) =>
                setField('prefOvernights', v ? Math.max(1, form.prefOvernights) : 0)
              }
              label="I'd like overnights with this partner"
              description="Toggle off if overnights aren't part of this relationship right now."
            />
          </div>
        )}
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
        <div
          className={`grid gap-x-10 gap-y-8 ${
            isFriendship ? 'sm:grid-cols-1' : 'sm:grid-cols-3'
          }`}
        >
          <Slider
            label="Min hours"
            unit="per cycle"
            value={form.needMinHours}
            onChange={(v) => setField('needMinHours', v)}
            min={0}
            max={Math.max(20, form.prefIdealHours)}
            step={0.5}
          />
          {!isFriendship && (
            <Slider
              label="Min date nights"
              unit="per cycle"
              value={form.needMinDateNights}
              onChange={(v) => setField('needMinDateNights', Math.round(v))}
              min={0}
              max={Math.max(3, form.prefDateNights)}
              step={1}
            />
          )}
          {!isFriendship && (
            <Slider
              label="Min overnights"
              unit="per cycle"
              value={form.needMinOvernights}
              onChange={(v) => setField('needMinOvernights', Math.round(v))}
              min={0}
              max={Math.max(3, form.prefOvernights)}
              step={1}
            />
          )}
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

const CADENCE_OPTIONS: Array<{ value: SchedulingCadence; label: string; hint: string }> = [
  { value: 'weekly', label: 'Weekly', hint: 'Plan every 7 days' },
  { value: 'biweekly', label: 'Biweekly', hint: 'Plan every 2 weeks' },
  { value: 'monthly', label: 'Monthly', hint: 'Plan every 4 weeks' },
];

interface CadencePickerProps {
  current: SchedulingCadence;
  pending: SchedulingCadence | null;
  pendingByMe: boolean | null;
  partnerName: string;
  onPropose: (next: SchedulingCadence) => void;
  onAccept: () => void;
  onDecline: () => void;
  proposing: boolean;
  accepting: boolean;
  declining: boolean;
}

/**
 * Inline cadence selector with two-party confirmation.
 *
 * Three visual states:
 *   1. No pending proposal → click a different option to propose it.
 *   2. Pending, proposed by viewer → muted "waiting" line + a way to withdraw.
 *   3. Pending, proposed by the other party → accept / decline banner.
 *
 * Clicking the *current* cadence while a viewer-proposed change is pending
 * is interpreted as a withdrawal (server treats propose-current as no-op
 * that clears any pending row).
 */
function CadencePicker({
  current,
  pending,
  pendingByMe,
  partnerName,
  onPropose,
  onAccept,
  onDecline,
  proposing,
  accepting,
  declining,
}: CadencePickerProps) {
  const busy = proposing || accepting || declining;
  const showOtherBanner = pending !== null && pendingByMe === false;
  const showMineBanner = pending !== null && pendingByMe === true;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {CADENCE_OPTIONS.map((opt) => {
          const isCurrent = opt.value === current;
          const isPending = opt.value === pending;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              onClick={() => onPropose(opt.value)}
              className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
                isCurrent
                  ? 'border-terracotta-500 bg-terracotta-50/60'
                  : isPending
                    ? 'border-ink-300 border-dashed bg-cream'
                    : 'border-ink-100 bg-cream hover:bg-ink-50'
              } ${busy ? 'opacity-60 cursor-wait' : ''}`}
            >
              <p className="font-display text-ink-800 text-base leading-tight">
                {opt.label}
                {isCurrent && (
                  <span className="ml-1 text-[10px] uppercase tracking-[0.14em] text-terracotta-600 font-medium">
                    · agreed
                  </span>
                )}
                {isPending && !isCurrent && (
                  <span className="ml-1 text-[10px] uppercase tracking-[0.14em] text-ink-500 font-medium">
                    · pending
                  </span>
                )}
              </p>
              <p className="text-[11px] text-ink-500 mt-0.5">{opt.hint}</p>
            </button>
          );
        })}
      </div>

      {showOtherBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sage-200 bg-sage-50/60 px-4 py-3">
          <p className="text-sm text-ink-700 leading-snug">
            <span className="font-display not-italic text-ink-900">{partnerName}</span>{' '}
            proposed <strong className="font-display not-italic">{pending}</strong> cycles.
            Accept to lock it in.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={onDecline} disabled={busy}>
              Decline
            </Button>
            <Button size="sm" onClick={onAccept} disabled={busy}>
              Accept
            </Button>
          </div>
        </div>
      )}

      {showMineBanner && (
        <p className="text-xs text-ink-500 italic">
          You proposed <strong className="font-display not-italic text-ink-700">{pending}</strong>.
          Waiting for {partnerName} to accept. Click the current cadence to withdraw.
        </p>
      )}
    </div>
  );
}
