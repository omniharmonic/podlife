import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { addDays } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Modal } from '@/components/ui/Modal';
import { EditorialHeading } from '@/components/ui/EditorialHeading';
import { useSetManualAvailability } from '@/hooks/useAvailability';
import { usePodsList, useCreatePod } from '@/hooks/usePods';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { passkeys as passkeysApi } from '@/lib/api';
import { enrollPasskey, isPasskeySupported } from '@/lib/passkeys';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { me as meApi, getSessionToken, calendars as calendarsApi } from '@/lib/api';
import { useUiStore } from '@/stores/ui.store';
import { format, getWeekStart } from '@/lib/dates';

const POD_EMOJIS = ['🏠', '🌳', '🌻', '🪴', '🍃', '🌿', '🌞', '🌙', '✨', '🔥'];

const COMMON_TZ = [
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
];

interface ManualWindow {
  day: number;
  start: string;
  end: string;
}

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function SettingsPage() {
  const { person, setPerson } = useAuth();
  const setAvailability = useSetManualAvailability();
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();

  // Calendar connections — refetch on mount so a successful OAuth callback
  // (which redirects back to /settings/calendars?connected=google) shows the
  // freshly-stored connection without a manual reload.
  const calendarConnections = useQuery({
    queryKey: ['calendars', 'connections'],
    queryFn: () => calendarsApi.list(),
    select: (d) => d.connections,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const disconnectCalendar = useMutation({
    mutationFn: (id: string) => calendarsApi.disconnect(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['calendars', 'connections'] }),
  });
  const googleConnection = (calendarConnections.data ?? []).find(
    (c) => c.provider === 'google',
  );

  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [timezone, setTimezone] = useState(person?.timezone ?? 'America/Denver');
  const [avatarUrl, setAvatarUrl] = useState(person?.avatarUrl ?? '');
  const [privacyMode, setPrivacyMode] = useState(person?.privacyMode ?? false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (person) {
      setDisplayName(person.displayName);
      setTimezone(person.timezone);
      setAvatarUrl(person.avatarUrl ?? '');
      setPrivacyMode(person.privacyMode);
    }
  }, [person]);

  const [windows, setWindows] = useState<ManualWindow[]>([
    { day: 0, start: '18:00', end: '22:00' },
    { day: 5, start: '09:00', end: '23:00' },
    { day: 6, start: '09:00', end: '23:00' },
  ]);

  const weekStart = useMemo(() => getWeekStart(new Date()), []);

  async function saveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    setSavingProfile(true);
    try {
      const updated = await meApi.update({
        displayName,
        timezone,
        avatarUrl: avatarUrl.trim() || null,
        privacyMode,
      });
      setPerson(updated);
      showToast('Profile saved', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not save profile',
        'error',
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveAvailability() {
    // Empty saves are valid — they clear all manual windows. The server's
    // schema permits 0–200 windows. When a calendar is connected, the
    // optimizer prefers it and ignores manual entries entirely (see
    // calendar.aggregator.ts: providerSucceeded short-circuit).
    const isoWindows = windows.map((w) => {
      const day = addDays(weekStart, w.day);
      const [sh = 0, sm = 0] = w.start.split(':').map(Number);
      const [eh = 0, em = 0] = w.end.split(':').map(Number);
      const startDate = new Date(day);
      startDate.setHours(sh, sm, 0, 0);
      const endDate = new Date(day);
      endDate.setHours(eh, em, 0, 0);
      return { start: startDate.toISOString(), end: endDate.toISOString() };
    });
    try {
      await setAvailability.mutateAsync(isoWindows);
      showToast('Availability saved for the week', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not save availability',
        'error',
      );
    }
  }

  function updateWindow(idx: number, patch: Partial<ManualWindow>) {
    setWindows((ws) => ws.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  }

  function removeWindow(idx: number) {
    setWindows((ws) => ws.filter((_, i) => i !== idx));
  }

  function addWindow() {
    setWindows((ws) => [...ws, { day: 0, start: '18:00', end: '22:00' }]);
  }

  // Pods — managed from Settings so single-pod users have a clear place
  // to add another without cluttering /pods (which auto-redirects when
  // they only have one). Multi-pod users can also use the list page.
  const podsList = usePodsList();
  const createPod = useCreatePod();
  const install = useInstallPrompt();

  const passkeySupported = isPasskeySupported();
  const passkeysQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => passkeysApi.list(),
    select: (d) => d.passkeys,
    enabled: passkeySupported,
  });
  const enrolledPasskeys = passkeysQuery.data ?? [];
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function onAddPasskey() {
    if (passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      const nickname = inferDeviceNickname();
      const result = await enrollPasskey(nickname);
      if (result.status === 'enrolled') {
        await queryClient.invalidateQueries({ queryKey: ['passkeys'] });
        showToast('Passkey saved on this device', 'success');
      } else if (result.status === 'error') {
        showToast(result.message, 'error');
      }
      // 'cancelled' is a quiet no-op.
    } finally {
      setPasskeyBusy(false);
    }
  }

  const removePasskey = useMutation({
    mutationFn: (id: string) => passkeysApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
  });
  const [podModalOpen, setPodModalOpen] = useState(false);
  const [podName, setPodName] = useState('');
  const [podEmoji, setPodEmoji] = useState('🏠');
  const [podMemberEmails, setPodMemberEmails] = useState('');

  async function onCreatePod(e?: React.FormEvent) {
    e?.preventDefault();
    if (!podName.trim()) return;
    try {
      await createPod.mutateAsync({
        name: podName.trim(),
        emoji: podEmoji,
        memberEmails: podMemberEmails
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      showToast(`Pod "${podName.trim()}" created`, 'success');
      setPodModalOpen(false);
      setPodName('');
      setPodEmoji('🏠');
      setPodMemberEmails('');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not create pod',
        'error',
      );
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-9"
    >
      <header>
        <EditorialHeading level={1} eyebrow="Settings">
          You and how Pod Life finds time for you
        </EditorialHeading>
      </header>

      {/* Profile */}
      <Section title="Profile">
        <form onSubmit={saveProfile} className="flex flex-col gap-6">
          <div className="flex items-center gap-5">
            <AvatarUploader
              currentUrl={avatarUrl}
              displayName={displayName || person?.displayName || '?'}
              onUploaded={(url) => {
                setAvatarUrl(url);
                if (person) setPerson({ ...person, avatarUrl: url });
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-display text-ink-800 text-2xl leading-tight">
                {displayName || person?.displayName || 'Your name'}
              </p>
              <p className="text-sm text-ink-500 mt-0.5">{person?.email}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
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
              {COMMON_TZ.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={savingProfile}>
              Save profile
            </Button>
          </div>
        </form>
      </Section>

      {/* Pods */}
      <Section title="Pods">
        <p className="text-sm text-ink-500 mb-4">
          A pod is a named group — your nesting partners, a co-living crew,
          a chosen family. Time gets scheduled inside a pod.
        </p>
        <div className="flex flex-col gap-2">
          {(podsList.data ?? []).map((pod) => (
            <Link
              key={pod.id}
              to={`/pods/${pod.id}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-ink-100/60 bg-cream hover:bg-parchment transition-colors"
            >
              <span className="text-xl" aria-hidden="true">{pod.emoji ?? '🏠'}</span>
              <span className="font-display text-ink-800 text-lg flex-1 truncate">
                {pod.name}
              </span>
              <span className="text-ink-300 text-lg" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
        <div className="mt-4">
          <Button variant="ghost" onClick={() => setPodModalOpen(true)}>
            {(podsList.data?.length ?? 0) === 0 ? 'Create your first pod' : 'Add a pod'}
          </Button>
        </div>
      </Section>

      {/* Passkeys — only shown on platforms that support WebAuthn (essentially
          everywhere modern). Lets the user skip the email-code dance on
          subsequent sign-ins. */}
      {passkeySupported && (
        <Section title="Passkeys">
          <p className="text-sm text-ink-500 mb-4">
            Save a passkey on this device and you can sign in with Face ID or
            Touch ID — no code, no email, no waiting.
          </p>
          {enrolledPasskeys.length === 0 ? (
            <div className="px-4 py-3 rounded-xl border border-dashed border-ink-200/70 bg-cream/60 text-sm text-ink-500 mb-4">
              {passkeysQuery.isLoading
                ? 'Looking…'
                : 'No passkeys yet on this account.'}
            </div>
          ) : (
            <ul className="flex flex-col gap-2 mb-4">
              {enrolledPasskeys.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-ink-100/60 bg-cream"
                >
                  <span aria-hidden="true" className="text-xl">
                    {p.deviceType === 'multiDevice' ? '🔑' : '🔐'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-800 font-medium truncate">
                      {p.nickname ?? 'Passkey'}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">
                      {p.lastUsedAt
                        ? `Last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                        : 'Not used yet'}
                      {p.backedUp ? ' · synced' : ' · this device only'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove this passkey? You'll need to sign in with a code to add another.`,
                        )
                      ) {
                        removePasskey.mutate(p.id);
                      }
                    }}
                    className="text-[12px] text-ink-500 hover:text-wine-600 underline-offset-4 hover:underline"
                    disabled={removePasskey.isPending}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" onClick={onAddPasskey} loading={passkeyBusy}>
            {enrolledPasskeys.length === 0
              ? 'Save a passkey'
              : 'Add another passkey'}
          </Button>
        </Section>
      )}

      {/* Install — only shown when the platform supports installation
          and the app isn't already running standalone. */}
      {install.showInSettings && (
        <Section title="Add to your home screen">
          <p className="text-sm text-ink-500 mb-4">
            Pod Life lives best as an app on your phone — opens faster, stays
            signed in, no browser chrome.
          </p>
          {install.canPrompt ? (
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-ink-100/60 bg-cream">
              <p className="text-sm text-ink-700 leading-relaxed">
                Install Pod Life as an app on this device.
              </p>
              <Button
                onClick={async () => {
                  const outcome = await install.promptInstall();
                  if (outcome === 'accepted') {
                    showToast('Pod Life is on your home screen', 'success');
                  }
                }}
              >
                Install
              </Button>
            </div>
          ) : install.isIOS ? (
            <ol className="text-sm text-ink-700 leading-[1.7] flex flex-col gap-1.5 px-4 py-3 rounded-xl border border-ink-100/60 bg-cream">
              <li>
                <span className="text-ink-400 mr-2 tabular-nums">1.</span>
                Tap the <span className="font-medium text-ink-800">Share</span>{' '}
                icon in Safari's toolbar
                <span aria-hidden="true" className="ml-1 text-ink-500">
                  (the square with an arrow pointing up)
                </span>
                .
              </li>
              <li>
                <span className="text-ink-400 mr-2 tabular-nums">2.</span>
                Choose{' '}
                <span className="font-medium text-ink-800">
                  Add to Home Screen
                </span>
                .
              </li>
              <li>
                <span className="text-ink-400 mr-2 tabular-nums">3.</span>
                Tap{' '}
                <span className="font-medium text-ink-800">Add</span> in the
                top-right.
              </li>
            </ol>
          ) : null}
        </Section>
      )}

      {/* Calendars */}
      <Section title="Calendars">
        <p className="text-sm text-ink-500 mb-4">
          Connect a calendar so Pod Life knows when you're free. We read free/busy
          windows only — never event titles.
        </p>
        <div className="flex flex-col">
          {/*
           * The /auth/calendar/* routes need the session token in the query
           * because they redirect into the OAuth provider, which drops headers.
           * Building the href lazily so the latest session token is used.
           */}
          <CalendarRow
            name="Google Calendar"
            connectHref={`/auth/calendar/google?token=${encodeURIComponent(getSessionToken() ?? '')}`}
            connection={googleConnection ?? undefined}
            onDisconnect={(id) => disconnectCalendar.mutate(id)}
            disconnecting={disconnectCalendar.isPending}
          />
          <CalendarRow name="Outlook" comingSoon />
          <CalendarRow name="iCloud (CalDAV)" comingSoon />
        </div>
      </Section>

      {/* Manual availability */}
      <Section title="Manual availability">
        <p className="text-sm text-ink-500 mb-4">
          Set free windows for the week of{' '}
          <span className="text-ink-800 font-medium">
            {format(weekStart, 'MMM d')}
          </span>
          . Use this if you don't connect a calendar.
        </p>
        {googleConnection ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-4">
            Google Calendar is connected — Pod Life uses your real free/busy
            windows and ignores anything you set here. Clear these to keep
            things tidy, or leave them as a fallback in case the calendar
            ever disconnects.
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {windows.map((w, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-end pb-3 border-b border-ink-100/60 last:border-b-0"
            >
              <Select
                value={w.day}
                onChange={(e) =>
                  updateWindow(i, { day: Number(e.currentTarget.value) })
                }
              >
                {DAY_NAMES.map((d, dIdx) => (
                  <option key={d} value={dIdx}>
                    {d}
                  </option>
                ))}
              </Select>
              <Input
                type="time"
                value={w.start}
                onChange={(e) => updateWindow(i, { start: e.currentTarget.value })}
              />
              <Input
                type="time"
                value={w.end}
                onChange={(e) => updateWindow(i, { end: e.currentTarget.value })}
              />
              <button
                type="button"
                onClick={() => removeWindow(i)}
                className="w-9 h-9 mb-1 rounded-full text-ink-400 hover:text-wine-500 hover:bg-wine-50 transition-colors"
                aria-label="Remove window"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2 mt-5">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={addWindow}>
              Add window
            </Button>
            {windows.length > 0 ? (
              <Button
                variant="ghost"
                onClick={() => setWindows([])}
                title="Remove every window from this list. Click Save to persist."
              >
                Clear all
              </Button>
            ) : null}
          </div>
          <Button onClick={saveAvailability} loading={setAvailability.isPending}>
            {windows.length === 0 ? 'Save (clear)' : 'Save availability'}
          </Button>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <p className="text-sm text-ink-600">
          Active channels:{' '}
          <span className="text-ink-800 font-medium">
            {(person?.notificationChannels ?? ['in_app']).join(', ')}
          </span>
        </p>
        <p className="text-xs text-ink-500 mt-2">
          Telegram setup coming soon. For now, use in-app notifications.
        </p>
      </Section>

      {/* Privacy */}
      <Section title="Privacy">
        <Toggle
          checked={privacyMode}
          onChange={setPrivacyMode}
          label="Privacy mode"
          description="Softens the edges of your free time by up to 30 minutes each check-in, so patterns in your schedule are harder to read from the outside. Trade-off: suggested times may shift slightly week to week."
        />
        <div className="flex justify-end mt-4">
          <Button onClick={() => saveProfile()} loading={savingProfile}>
            Save privacy setting
          </Button>
        </div>
      </Section>

      <Modal
        open={podModalOpen}
        onClose={() => setPodModalOpen(false)}
        title="Create a pod"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPodModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onCreatePod}
              loading={createPod.isPending}
              disabled={!podName.trim()}
            >
              Create
            </Button>
          </>
        }
      >
        <form onSubmit={onCreatePod} className="flex flex-col gap-6">
          <Input
            label="Pod name"
            placeholder="e.g., Home Base"
            value={podName}
            onChange={(e) => setPodName(e.currentTarget.value)}
            required
          />
          <div>
            <span className="eyebrow text-ink-500 mb-2 block">Emoji</span>
            <div className="flex flex-wrap gap-2">
              {POD_EMOJIS.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => setPodEmoji(e)}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl border transition-all ${
                    podEmoji === e
                      ? 'bg-terracotta-50 border-terracotta-500 scale-105'
                      : 'bg-cream border-ink-100 hover:bg-ink-50'
                  }`}
                  aria-label={`Choose emoji ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Invite members (optional)"
            placeholder="email@example.com, another@example.com"
            value={podMemberEmails}
            onChange={(e) => setPodMemberEmails(e.currentTarget.value)}
            hint="Separate emails with commas. They'll receive an invitation."
          />
        </form>
      </Modal>
    </motion.div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

/**
 * Best-effort device label so a user with several passkeys can tell them
 * apart. UA-CH `userAgentData` gives clean platform names on Chromium; a
 * userAgent regex covers everywhere else. Falls back to `Passkey` so the
 * server has a non-empty nickname even on weird browsers.
 */
function inferDeviceNickname(): string {
  if (typeof navigator === 'undefined') return 'Passkey';
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData;
  if (uaData?.platform) {
    return `${uaData.platform} passkey`;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone passkey';
  if (/Android/.test(ua)) return 'Android passkey';
  if (/Mac/.test(ua)) return 'Mac passkey';
  if (/Windows/.test(ua)) return 'Windows passkey';
  if (/Linux/.test(ua)) return 'Linux passkey';
  return 'Passkey';
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-ink-800 text-2xl">{title}</h2>
      {children}
    </section>
  );
}

interface AvatarUploaderProps {
  currentUrl: string;
  displayName: string;
  onUploaded: (url: string) => void;
}

/**
 * Hover-to-replace avatar tile. The visible Avatar is the click target —
 * a hidden file input takes the upload. We immediately preview the chosen
 * file via object URL so the UI feels instant, then swap to the Blob URL
 * the server returns once the upload lands.
 */
function AvatarUploader({ currentUrl, displayName, onUploaded }: AvatarUploaderProps) {
  const showToast = useUiStore((s) => s.showToast);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputId = 'avatar-file-input';

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('That file isn’t an image — try a JPG or PNG?', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('That image is over 5 MB — could you crop or compress it?', 'error');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    try {
      const updated = await meApi.uploadAvatar(file);
      onUploaded(updated.avatarUrl ?? '');
      showToast('Profile picture saved', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Couldn't quite upload that — try again?",
        'error',
      );
    } finally {
      setUploading(false);
      // Keep the local preview until the parent re-renders with the new URL.
      // Revoking the object URL too early flashes the old avatar.
      setTimeout(() => {
        URL.revokeObjectURL(localUrl);
        setPreviewUrl(null);
      }, 1000);
    }
  }

  const shownUrl = previewUrl || currentUrl.trim() || undefined;

  return (
    <label
      htmlFor={inputId}
      className="relative cursor-pointer group focus-within:ring-2 focus-within:ring-terracotta-400 rounded-full"
      title="Click to choose a new picture"
    >
      <Avatar
        name={displayName}
        src={shownUrl}
        size={88}
        className="ring-2 ring-cream shadow-paper"
      />
      <span
        aria-hidden="true"
        className={
          'absolute inset-0 rounded-full flex items-center justify-center text-cream text-[11px] uppercase tracking-[0.16em] font-medium ' +
          (uploading
            ? 'bg-ink-800/70'
            : 'bg-ink-800/0 group-hover:bg-ink-800/55 transition-colors')
        }
      >
        {uploading ? 'Uploading…' : <span className="opacity-0 group-hover:opacity-100">Replace</span>}
      </span>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onFileChange}
        disabled={uploading}
      />
    </label>
  );
}

interface CalendarRowProps {
  name: string;
  connectHref?: string;
  comingSoon?: boolean;
  /** When provided, the row shows a Connected badge + Disconnect button. */
  connection?: { id: string; lastSyncedAt: string | null; syncError: string | null };
  onDisconnect?: (id: string) => void;
  disconnecting?: boolean;
}

function CalendarRow({
  name,
  connectHref,
  comingSoon,
  connection,
  onDisconnect,
  disconnecting,
}: CalendarRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-ink-100/60 last:border-b-0">
      <div className="flex flex-col">
        <span className="text-[15px] text-ink-800 font-medium">{name}</span>
        {connection?.syncError ? (
          <span className="text-[12px] text-rose-600 mt-0.5">{connection.syncError}</span>
        ) : null}
      </div>
      {comingSoon ? (
        <span className="text-[10px] uppercase tracking-[0.14em] font-medium text-ink-500 bg-ink-50 border border-ink-100 px-2 py-0.5 rounded-full">
          Coming soon
        </span>
      ) : connection ? (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            Connected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDisconnect?.(connection.id)}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
      ) : (
        <a href={connectHref}>
          <Button variant="ghost" size="sm">
            Connect
          </Button>
        </a>
      )}
    </div>
  );
}
