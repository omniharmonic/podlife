import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { addDays } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { EditorialHeading } from '@/components/ui/EditorialHeading';
import { useSetManualAvailability } from '@/hooks/useAvailability';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { me as meApi, getSessionToken, calendars as calendarsApi } from '@/lib/api';
import { useUiStore } from '@/stores/ui.store';
import { format, getWeekStart } from '@/lib/dates';

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-9"
    >
      <header>
        <EditorialHeading level={1} eyebrow="Settings">
          Your profile & preferences
        </EditorialHeading>
      </header>

      {/* Profile */}
      <Section title="Profile">
        <form onSubmit={saveProfile} className="flex flex-col gap-6">
          <div className="flex items-center gap-5">
            <Avatar
              name={displayName || person?.displayName || '?'}
              src={avatarUrl.trim() || undefined}
              size={88}
              className="ring-2 ring-cream shadow-paper"
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
            <div className="sm:col-span-2">
              <Input
                label="Profile picture URL"
                placeholder="https://…"
                hint="Paste a public image URL (e.g., from your social profile). Leave blank for an initials avatar."
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.currentTarget.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={savingProfile}>
              Save profile
            </Button>
          </div>
        </form>
      </Section>

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
          label="Privacy mode (scheduling jitter)"
          description="Adds up to 30 minutes of random shift to your free-window edges each cycle. Trade-off: scheduled times may move slightly between cycles."
        />
        <div className="flex justify-end mt-4">
          <Button onClick={() => saveProfile()} loading={savingProfile}>
            Save privacy setting
          </Button>
        </div>
      </Section>
    </motion.div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-ink-800 text-2xl">{title}</h2>
      {children}
    </section>
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
