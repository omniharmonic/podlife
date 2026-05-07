import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useInvitePartner } from '@/hooks/usePartners';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { DropCap } from '@/components/ui/DropCap';
import { Flourish } from '@/components/ui/Flourish';
import { EditorialHeading } from '@/components/ui/EditorialHeading';
import { me as meApi } from '@/lib/api';
import { useUiStore } from '@/stores/ui.store';

const STEPS = ['welcome', 'cycles', 'rest', 'profile', 'invite', 'done'] as const;
type StepId = (typeof STEPS)[number];

const ONBOARDED_KEY = 'podlife.onboarded';

export function OnboardingPage() {
  const { person, setPerson } = useAuth();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [stepIdx, setStepIdx] = useState(0);
  const [restEvenings, setRestEvenings] = useState(2);
  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [timezone, setTimezone] = useState(person?.timezone ?? 'America/Denver');
  const [skipping, setSkipping] = useState(false);
  const invite = useInvitePartner();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const stepId: StepId = STEPS[stepIdx]!;

  function next() {
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function back() {
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  async function finish() {
    setSkipping(true);
    // Always set the local flag first, regardless of API outcome.
    // RequireAuth treats either `person.onboardedAt` OR this localStorage
    // key as "onboarded", so this guarantees we exit the flow.
    try {
      localStorage.setItem(ONBOARDED_KEY, 'true');
    } catch {
      /* ignore */
    }
    try {
      const updated = await meApi.update({
        displayName: displayName || person?.displayName,
        timezone,
        // onboardedAt is accepted by the API; if the deployed API doesn't
        // support it yet, the field is silently stripped — that's fine
        // because the local flag above already gets us past RequireAuth.
        onboardedAt: new Date().toISOString(),
      } as Parameters<typeof meApi.update>[0]);
      setPerson(updated);
    } catch {
      /* swallow — local flag is sufficient */
    } finally {
      setSkipping(false);
      navigate('/home', { replace: true });
    }
  }

  async function generateInvite() {
    try {
      const res = await invite.mutateAsync();
      setInviteUrl(res.inviteUrl);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not create invite',
        'error',
      );
    }
  }

  return (
    <div className="min-h-screen bg-parchment flex flex-col">
      {/* Top bar with progress dots & skip */}
      <header className="px-6 pt-8 pb-2 flex items-center justify-between max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1 transition-all ${
                i === stepIdx
                  ? 'w-8 bg-terracotta-500'
                  : i < stepIdx
                    ? 'w-4 bg-ink-400'
                    : 'w-4 bg-ink-200'
              } rounded-full`}
              aria-hidden="true"
            />
          ))}
        </div>
        <button
          type="button"
          onClick={finish}
          className="text-xs font-mono uppercase tracking-widest text-ink-500 hover:text-ink-800"
        >
          Skip for now
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait">
          <motion.section
            key={stepId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="w-full max-w-2xl"
          >
            {stepId === 'welcome' && <WelcomeStep />}
            {stepId === 'cycles' && <CyclesStep />}
            {stepId === 'rest' && (
              <RestStep value={restEvenings} onChange={setRestEvenings} />
            )}
            {stepId === 'profile' && (
              <ProfileStep
                displayName={displayName}
                setDisplayName={setDisplayName}
                timezone={timezone}
                setTimezone={setTimezone}
              />
            )}
            {stepId === 'invite' && (
              <InviteStep
                inviteUrl={inviteUrl}
                generating={invite.isPending}
                onGenerate={generateInvite}
              />
            )}
            {stepId === 'done' && <DoneStep />}

            {/* Footer nav */}
            <div className="mt-12 flex items-center justify-between">
              {stepIdx > 0 ? (
                <button
                  type="button"
                  onClick={back}
                  className="text-xs font-mono uppercase tracking-widest text-ink-500 hover:text-ink-800"
                >
                  ← Back
                </button>
              ) : (
                <span />
              )}
              {stepId === 'done' ? (
                <Button onClick={finish} loading={skipping} size="lg">
                  Take me to my calendar
                </Button>
              ) : (
                <Button onClick={next} size="lg">
                  {stepId === 'invite' ? 'Almost done' : 'Continue'}
                </Button>
              )}
            </div>
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="flex flex-col gap-8 text-center">
      <p className="eyebrow">Vol. I · A first letter</p>
      <h1
        className="font-display italic text-ink-800 text-5xl sm:text-6xl leading-[1.05]"
        style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 80, 'wght' 380" }}
      >
        Welcome to Pod Life
      </h1>
      <Flourish variant="laurel" className="w-44 h-7 text-ink-300 mx-auto" />
      <div className="text-left flex flex-col gap-5 max-w-xl mx-auto">
        <DropCap>
          You are not the kind of person who takes love lightly. You have more
          than one. You want each one held well — given enough time,
          enough attention, enough rest in between.
        </DropCap>
        <p className="text-base text-ink-700 leading-[1.7]">
          Pod Life is a small instrument for that. You connect a calendar,
          tell us what you'd love each cycle, and we propose a fair schedule
          — fair meaning nobody gets the short end, mathematically.
        </p>
        <p className="text-base text-ink-700 leading-[1.7]">
          We won't peek at your event titles. We won't tell anyone what
          anyone else is doing. The system is built around the idea that
          relationships need privacy and time, in equal measure.
        </p>
      </div>
    </div>
  );
}

function CyclesStep() {
  return (
    <div className="flex flex-col gap-8">
      <header className="text-center">
        <p className="eyebrow mb-3">An almanac</p>
        <EditorialHeading level={2}>What is a cycle?</EditorialHeading>
      </header>

      {/* Diagram — 7 day-circles */}
      <div className="flex justify-center my-4">
        <svg viewBox="0 0 320 80" className="w-full max-w-md" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => {
            const cx = 28 + i * 44;
            return (
              <g key={i}>
                <circle cx={cx} cy={40} r={16} fill="#FFFCF6" stroke="#1B1814" strokeWidth="0.8" />
                <text
                  x={cx}
                  y={45}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#473F33"
                  fontFamily="DM Mono, monospace"
                >
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
                </text>
              </g>
            );
          })}
          <path d="M 12 40 Q 160 5, 308 40" fill="none" stroke="#C25B3F" strokeWidth="0.8" strokeDasharray="2 3" />
        </svg>
      </div>

      <div className="text-center max-w-xl mx-auto flex flex-col gap-4">
        <p className="text-base text-ink-700 leading-[1.8]">
          A cycle is one round of planning — most pods use a week. Every
          cycle, you tell us what you'd love and we propose a fair schedule.
        </p>
        <p className="text-sm text-ink-500 italic">
          You'll review the proposal, accept what works, and ask to reshuffle
          what doesn't. Then it locks for the cycle.
        </p>
      </div>
    </div>
  );
}

interface RestStepProps {
  value: number;
  onChange: (v: number) => void;
}

function RestStep({ value, onChange }: RestStepProps) {
  return (
    <div className="flex flex-col gap-8">
      <header className="text-center">
        <p className="eyebrow mb-3">Solo rest</p>
        <EditorialHeading level={2}>Your time</EditorialHeading>
      </header>
      <p className="text-base text-ink-700 leading-[1.7] max-w-xl mx-auto text-center">
        How many free evenings do you need each week to recharge alone?
        Two is a healthy default for most people. The optimizer will protect
        these from getting filled.
      </p>
      <div className="max-w-md mx-auto w-full">
        <Slider
          label="Solo evenings"
          unit="per week"
          value={value}
          onChange={(v) => onChange(Math.round(v))}
          min={0}
          max={7}
          step={1}
        />
      </div>
    </div>
  );
}

interface ProfileStepProps {
  displayName: string;
  setDisplayName: (v: string) => void;
  timezone: string;
  setTimezone: (v: string) => void;
}

function ProfileStep({ displayName, setDisplayName, timezone, setTimezone }: ProfileStepProps) {
  return (
    <div className="flex flex-col gap-8">
      <header className="text-center">
        <p className="eyebrow mb-3">An honest signature</p>
        <EditorialHeading level={2}>Who you are</EditorialHeading>
      </header>
      <div className="grid sm:grid-cols-2 gap-x-10 gap-y-6 max-w-xl mx-auto w-full">
        <Input
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
          required
        />
        <Select
          label="Timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.currentTarget.value)}
        >
          {[
            'America/Los_Angeles',
            'America/Denver',
            'America/Chicago',
            'America/New_York',
            'America/Toronto',
            'Europe/London',
            'Europe/Paris',
            'Europe/Berlin',
            'Asia/Tokyo',
            'Asia/Shanghai',
            'Australia/Sydney',
            'UTC',
          ].map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

interface InviteStepProps {
  inviteUrl: string | null;
  generating: boolean;
  onGenerate: () => void;
}

function InviteStep({ inviteUrl, generating, onGenerate }: InviteStepProps) {
  return (
    <div className="flex flex-col gap-8">
      <header className="text-center">
        <p className="eyebrow mb-3">A first envelope</p>
        <EditorialHeading level={2}>Add your first partner</EditorialHeading>
      </header>
      <p className="text-base text-ink-700 leading-[1.7] max-w-xl mx-auto text-center">
        Share a private link with a partner. Once they accept, you can both
        set preferences for time together. (Skip this — you can always do it
        later from the Partners page.)
      </p>
      <div className="max-w-md mx-auto w-full">
        {inviteUrl ? (
          <div className="bg-ink-50 border border-dashed border-ink-200 rounded-md px-3 py-3 text-sm break-all font-mono text-ink-700">
            {inviteUrl}
          </div>
        ) : (
          <div className="text-center">
            <Button onClick={onGenerate} loading={generating} variant="secondary">
              Generate invite link
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function DoneStep() {
  return (
    <div className="flex flex-col gap-8 text-center">
      <p className="eyebrow">Volume one, page one</p>
      <h1
        className="font-display italic text-ink-800 text-5xl sm:text-6xl leading-tight"
        style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 80, 'wght' 380" }}
      >
        You're set.
      </h1>
      <Flourish variant="laurel" className="w-44 h-7 text-ink-300 mx-auto" />
      <p className="text-base text-ink-700 leading-[1.7] max-w-xl mx-auto italic">
        Now you can add partners, create a pod, and let Pod Life draft a
        first schedule. Take it slow — there's no hurry.
      </p>
    </div>
  );
}
