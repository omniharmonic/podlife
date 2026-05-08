import { useCallback, useEffect, useState } from 'react';

/**
 * PWA install affordance — wraps the platform-specific zoo of install paths
 * behind a single hook the UI can render against.
 *
 * Three states matter:
 *  - `isInstalled`  → already running standalone; surface nothing
 *  - `canPrompt`    → Chromium fired `beforeinstallprompt`; we can call it
 *  - `isIOS`        → Safari on iPhone/iPad; no programmatic install, only
 *                     the Share → Add to Home Screen flow. UI shows hint.
 *
 * Dismissal is sticky (localStorage) so the soft onboarding nudge doesn't
 * resurface every visit. The Settings install row ignores dismissal — it's
 * a destination, not a nudge.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'podlife.installPrompt.dismissed';

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPad on iOS 13+ reports MacIntel — sniff for touch as a tiebreaker.
  const iPadOS = /Mac/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari uses a non-standard `standalone` flag on navigator.
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(detectStandalone);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(DISMISS_KEY) === '1';
  });

  const isIOS = detectIOS();

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setIsInstalled(true);
      setDeferred(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Also react if the user installs via browser UI mid-session.
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setIsInstalled(mq.matches);
    mq.addEventListener?.('change', onChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener?.('change', onChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable' as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // Spec: a deferred prompt can be used at most once.
    setDeferred(null);
    return outcome;
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode or storage disabled — soft-fail; the in-memory state is
      // enough for the rest of this session.
    }
  }, []);

  const reset = useCallback(() => {
    setDismissed(false);
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // What the UI should do, distilled to one flag set:
  const canPrompt = Boolean(deferred);
  // The soft onboarding nudge appears only when there's something to nudge
  // toward and we haven't been told to stop.
  const showNudge = !isInstalled && !dismissed && (canPrompt || isIOS);
  // Settings always shows the install destination if the platform supports
  // it at all — even if the user dismissed the home-screen nudge.
  const showInSettings = !isInstalled && (canPrompt || isIOS);

  return {
    isInstalled,
    isIOS,
    canPrompt,
    showNudge,
    showInSettings,
    promptInstall,
    dismiss,
    reset,
  };
}
