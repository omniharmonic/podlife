import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Flourish } from '@/components/ui/Flourish';
import { auth } from '@/lib/api';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus({ kind: 'submitting' });
    try {
      await auth.requestMagicLink(trimmed);
      setStatus({ kind: 'sent', email: trimmed });
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
      });
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-parchment">
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
          className="w-full max-w-md flex flex-col items-center text-center"
        >
          <p className="eyebrow mb-8">Vol. I · An honest accounting of time</p>

          <h1
            className="font-display italic text-ink-800 text-6xl sm:text-7xl leading-[0.95] mb-2"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 80, 'wght' 380" }}
          >
            Pod Life
          </h1>

          <Flourish variant="laurel" className="w-32 h-7 text-ink-300 my-6" />

          <p className="text-ink-600 max-w-sm mb-12 italic leading-relaxed text-base">
            Scheduling that feels fair — for partners, pods, and the people you love.
          </p>

          {status.kind === 'sent' ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full max-w-sm"
            >
              <p className="font-display italic text-2xl text-ink-800 mb-3"
                 style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 60, 'wght' 440" }}>
                Check your inbox
              </p>
              <p className="text-sm text-ink-600 mb-1">A sign-in letter is on its way to</p>
              <p className="font-mono text-sm text-ink-800 mb-6 tracking-wide">{status.email}</p>
              <p className="text-xs text-ink-400 italic mb-6">
                In development, the link is logged to the API console.
              </p>
              <button
                type="button"
                onClick={() => setStatus({ kind: 'idle' })}
                className="text-sm text-terracotta-600 underline-offset-4 hover:underline"
              >
                Use a different address
              </button>
            </motion.div>
          ) : (
            <form onSubmit={onSubmit} className="w-full max-w-sm flex flex-col gap-7">
              <Input
                type="email"
                name="email"
                label="Email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@somewhere.kind"
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                error={status.kind === 'error' ? status.message : undefined}
                hint="No password — we'll send a one-time link."
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={status.kind === 'submitting'}
                disabled={!email.trim()}
              >
                Send sign-in link
              </Button>
            </form>
          )}

          <p
            className="mt-16 text-ink-400 italic text-sm max-w-xs leading-relaxed"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            "We make time for what we love by being honest about how little of it
            we have."
          </p>
        </motion.div>
      </main>
    </div>
  );
}
