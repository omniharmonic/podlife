import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { auth } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Flourish } from '@/components/ui/Flourish';

// Dedupe verify calls across React.StrictMode's double-mount so we don't
// burn the one-time token on the second mount and surface a spurious 401.
const inflight = new Map<string, ReturnType<typeof auth.verify>>();

export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [welcomed, setWelcomed] = useState(false);

  useEffect(() => {
    const token = params.get('token');
    const email = params.get('email');
    if (!token || !email) {
      setError('Invalid sign-in link.');
      return;
    }

    const key = `${email}|${token}`;
    let p = inflight.get(key);
    if (!p) {
      p = auth.verify(email, token);
      inflight.set(key, p);
    }

    let cancelled = false;
    p.then(
      (result) => {
        if (cancelled) return;
        login(result.sessionToken, result.person);
        setWelcomed(true);
        // Brief greeting before redirect — first-timers go to onboarding.
        const isFirstTime = !result.person.onboardedAt;
        const target = isFirstTime ? '/onboarding' : '/home';
        setTimeout(() => navigate(target, { replace: true }), 900);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'This sign-in link is invalid or has expired.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [params, login, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-parchment px-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-md w-full text-center"
      >
        {error ? (
          <>
            <h1 className="font-display italic text-ink-800 text-3xl mb-3"
                style={{ fontVariationSettings: "'opsz' 72, 'SOFT' 60, 'wght' 440" }}>
              Couldn't sign you in
            </h1>
            <p className="text-sm text-ink-600 mb-8 italic">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="text-sm font-mono uppercase tracking-widest text-terracotta-600 hover:underline"
            >
              ← Back to sign in
            </button>
          </>
        ) : welcomed ? (
          <>
            <h1 className="font-display italic text-ink-800 text-5xl mb-4"
                style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'wght' 380" }}>
              Welcome back
            </h1>
            <Flourish variant="laurel" className="w-32 h-7 text-ink-300 mx-auto" />
          </>
        ) : (
          <>
            <PressIndicator />
            <p className="font-display italic text-2xl text-ink-700 mt-8"
               style={{ fontVariationSettings: "'opsz' 48, 'SOFT' 60, 'wght' 420" }}>
              Pressing the seal…
            </p>
            <p className="text-xs text-ink-400 italic mt-2">Just a moment.</p>
          </>
        )}
      </motion.div>
    </div>
  );
}

function PressIndicator() {
  return (
    <motion.div
      animate={{ rotate: [0, -6, 6, 0] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      className="w-12 h-12 mx-auto rounded-full bg-wine-500 shadow-seal"
      aria-hidden="true"
    />
  );
}
