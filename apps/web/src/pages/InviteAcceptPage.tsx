import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useAcceptInvite } from '@/hooks/usePartners';
import { invites } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Flourish } from '@/components/ui/Flourish';
import { useUiStore } from '@/stores/ui.store';

/**
 * Unified invite landing page. The frontend route /join/:token (and the
 * legacy /invite/:token alias) both render this. We preview the invite
 * without authentication so a cold invitee — someone with no account yet —
 * can see who invited them and what they're being invited to *before*
 * deciding to sign up.
 *
 * Cold flow:  preview → "Sign in / create account" → magic code → accept
 * Warm flow:  preview → "Break the seal" → accept
 *
 * The accept response carries `kind` so we can route to the right
 * destination (/partners for partner invites, /pods/:id for pod invites).
 */
export function InviteAcceptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { isAuthenticated, isHydrated } = useAuth();
  const accept = useAcceptInvite();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [accepted, setAccepted] = useState(false);
  const [breaking, setBreaking] = useState(false);

  // Public preview: works regardless of session state. We rely on this both
  // to render the right copy (partner vs pod) and to detect revoked /
  // already-accepted invites before the user even tries to accept.
  const previewQ = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => invites.preview(token),
    enabled: !!token,
    retry: false,
    staleTime: 30_000,
  });

  async function handleAccept() {
    setBreaking(true);
    try {
      const result = await accept.mutateAsync(token);
      setAccepted(true);
      const successMsg =
        result.kind === 'pod' ? 'Welcome to the pod' : 'Partnership confirmed';
      showToast(successMsg, 'success');
      const dest = result.kind === 'pod' ? `/pods/${result.podId}` : '/partners';
      setTimeout(() => navigate(dest, { replace: true }), 900);
    } catch (err) {
      setBreaking(false);
      showToast(
        err instanceof Error ? err.message : 'Could not accept invite',
        'error',
      );
    }
  }

  const preview = previewQ.data;
  const previewError = previewQ.error as Error | undefined;

  // Headline + body copy depends on what kind of invite this is. Pulled out
  // so the JSX below stays tidy.
  const headline = !preview
    ? "You've been invited"
    : preview.kind === 'pod'
      ? `Join ${preview.podName ?? 'a pod'}`
      : preview.relationshipType === 'friendship'
        ? `${preview.inviterDisplayName} wants to share time with you`
        : `${preview.inviterDisplayName} wants to make time for you`;

  const subcopy = !preview
    ? 'Someone in your life wants to make time for you. Accept the invitation and you\'ll each share what kind of time matters with the other — Pod Life takes care of the rest.'
    : preview.kind === 'pod'
      ? `${preview.inviterDisplayName} invited you to join a pod. Pods are groups of people who share scheduling rhythms — accept to start coordinating time together.`
      : 'Accept the invitation and you\'ll each share what kind of time matters with the other — Pod Life takes care of the rest.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-parchment px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full text-center"
      >
        {/* Wax seal — animates "breaking" on accept */}
        <motion.div
          animate={
            breaking
              ? { rotate: [0, -8, 8, -3, 0], scale: [1, 1.08, 0.98, 1] }
              : { rotate: 0, scale: 1 }
          }
          transition={{ duration: 0.7 }}
          className="mx-auto mb-8 w-20 h-20 rounded-full bg-wine-500 shadow-seal flex items-center justify-center"
          aria-hidden="true"
        >
          <span
            className="font-display italic text-cream text-3xl leading-none"
            style={{ fontVariationSettings: "'opsz' 72, 'SOFT' 60, 'wght' 600" }}
          >
            P
          </span>
        </motion.div>

        <p className="eyebrow mb-4">A letter for you</p>
        <h1
          className="font-display italic text-ink-800 text-4xl sm:text-5xl mb-6 leading-tight"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 70, 'wght' 400" }}
        >
          {headline}
        </h1>
        <Flourish variant="laurel" className="w-32 h-7 text-ink-300 mx-auto mb-6" />
        <p className="text-ink-600 mb-10 italic leading-relaxed">{subcopy}</p>

        {previewError ? (
          <p className="text-ink-400 italic text-sm">
            This invitation is no longer valid. It may have expired, been
            revoked, or already been accepted.
          </p>
        ) : accepted ? (
          <p
            className="font-display italic text-sage-700 text-2xl"
            style={{ fontVariationSettings: "'opsz' 48, 'SOFT' 60, 'wght' 460" }}
          >
            Welcome aboard.
          </p>
        ) : !isHydrated || previewQ.isLoading ? (
          <p className="text-ink-400 italic text-sm">Loading…</p>
        ) : isAuthenticated ? (
          <Button fullWidth size="lg" onClick={handleAccept} loading={accept.isPending}>
            Break the seal
          </Button>
        ) : (
          <div className="flex flex-col gap-4">
            <Link to={`/login?next=/join/${encodeURIComponent(token)}`}>
              <Button fullWidth size="lg">
                Sign in or create an account
              </Button>
            </Link>
            <p className="text-xs text-ink-500 italic">
              No account yet? Use any email — we'll set you up and then bring
              you back here to accept.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
