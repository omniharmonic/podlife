import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useAcceptPartnerInvite } from '@/hooks/usePartners';
import { Button } from '@/components/ui/Button';
import { Flourish } from '@/components/ui/Flourish';
import { useUiStore } from '@/stores/ui.store';

export function InviteAcceptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { isAuthenticated, isHydrated } = useAuth();
  const accept = useAcceptPartnerInvite();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [accepted, setAccepted] = useState(false);
  const [breaking, setBreaking] = useState(false);

  async function handleAccept() {
    setBreaking(true);
    try {
      await accept.mutateAsync(token);
      setAccepted(true);
      showToast('Partnership confirmed', 'success');
      setTimeout(() => navigate('/partners', { replace: true }), 900);
    } catch (err) {
      setBreaking(false);
      showToast(
        err instanceof Error ? err.message : 'Could not accept invite',
        'error',
      );
    }
  }

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
          You've been invited
        </h1>
        <Flourish variant="laurel" className="w-32 h-7 text-ink-300 mx-auto mb-6" />
        <p className="text-ink-600 mb-10 italic leading-relaxed">
          Someone in your life wants to make time for you. Accept the invitation
          and you'll each share what kind of time matters with the other —
          Pod Life takes care of the rest.
        </p>

        {accepted ? (
          <p className="font-display italic text-sage-700 text-2xl"
             style={{ fontVariationSettings: "'opsz' 48, 'SOFT' 60, 'wght' 460" }}>
            Welcome aboard.
          </p>
        ) : !isHydrated ? (
          <p className="text-ink-400 italic text-sm">Loading…</p>
        ) : isAuthenticated ? (
          <Button
            fullWidth
            size="lg"
            onClick={handleAccept}
            loading={accept.isPending}
          >
            Break the seal
          </Button>
        ) : (
          <div className="flex flex-col gap-4">
            <Link to={`/login?next=/invite/${encodeURIComponent(token)}`}>
              <Button fullWidth size="lg">
                Sign in to accept
              </Button>
            </Link>
            <p className="text-xs text-ink-500 italic">
              No account? Use the email this invite was sent to and we'll
              recognize you.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
