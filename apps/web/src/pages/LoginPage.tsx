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

const FOUNDED_YEAR = new Date().getFullYear();
const TODAY_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date());

/**
 * Landing page — designed as a printed correspondence.
 *
 * Voice ground rules (see .claude/pod-life-brand-voice.md):
 *  - Lead with love, not logistics. The first thing read is care.
 *  - Tagline is "I want what you want." — a polycule's animating principle.
 *  - Avoid "scheduling," "optimize," "fair" as the lead concept.
 *
 * Layout: a single centered column, paced like reading a letter. The logo
 * is treated as an embossed seal at the top; the tagline is the largest
 * type on the page; sign-in is the quiet practical close at the bottom.
 */
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
            : 'Something went sideways. One more try?',
      });
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-parchment overflow-hidden">
      {/* Soft paper grain — subtle dual radial wash to add depth without imagery. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(194, 91, 63, 0.06), transparent 60%), ' +
            'radial-gradient(ellipse 80% 60% at 50% 100%, rgba(129, 178, 154, 0.05), transparent 60%)',
        }}
      />

      {/* Masthead — like the dateline of a letter. */}
      <header className="relative z-10 px-6 sm:px-10 pt-6 sm:pt-8 flex items-center justify-between max-w-5xl mx-auto w-full">
        <span className="eyebrow text-ink-400">Pod Life · Vol. {FOUNDED_YEAR - 2025 || 'I'}</span>
        <span className="eyebrow text-ink-400 hidden sm:inline">{TODAY_FMT}</span>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="w-full max-w-xl flex flex-col items-center text-center"
        >
          {/* Logo seal — the visual anchor */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.05, ease: [0.32, 0.72, 0, 1] }}
            className="relative mb-6"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 -m-3 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 50% 40%, rgba(194,91,63,0.10), transparent 65%)',
              }}
            />
            <img
              src="/podlife_logo_alpha.png"
              alt="Pod Life"
              width={160}
              height={160}
              className="relative block w-32 h-32 sm:w-40 sm:h-40 object-contain drop-shadow-[0_2px_18px_rgba(27,24,20,0.12)]"
            />
          </motion.div>

          <p className="eyebrow text-ink-500 mb-4">An honest accounting of time</p>

          {/* The tagline — the load-bearing typographic moment */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="font-display italic text-ink-800 text-[2.75rem] sm:text-[4.25rem] leading-[0.94] tracking-[-0.01em] mb-3"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 60, 'wght' 380" }}
          >
            I want
            <br />
            what you want.
          </motion.h1>

          <Flourish variant="laurel" className="w-32 h-7 text-ink-300 my-7" />

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.32 }}
            className="text-ink-700 max-w-md mb-2 leading-[1.7] text-[15.5px]"
          >
            A small instrument for the people who love more than one person —
            and want to actually show up for all of them.
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.42 }}
            className="text-ink-500 max-w-md mb-12 leading-[1.7] text-[14.5px] italic"
          >
            Tell us what kind of time matters with each person.
            We'll find a plan where everyone gets cared for.
          </motion.p>

          {/* Sign-in form — quiet practical close */}
          {status.kind === 'sent' ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full max-w-sm border-t border-b border-ink-200/60 py-8"
            >
              <p
                className="font-display italic text-3xl text-ink-800 mb-4"
                style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 60, 'wght' 440" }}
              >
                A letter is on its way
              </p>
              <p className="text-sm text-ink-600 mb-1 leading-relaxed">
                We've sent a one-time sign-in link to
              </p>
              <p className="font-mono text-[13px] text-ink-800 mb-6 tracking-wide break-all">
                {status.email}
              </p>
              <p className="text-xs text-ink-400 italic mb-6 leading-relaxed">
                Check your inbox. The link works once and expires in
                fifteen minutes — like most good things.
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
            <motion.form
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              onSubmit={onSubmit}
              className="w-full max-w-sm flex flex-col gap-7"
            >
              <Input
                type="email"
                name="email"
                label="Where should we write?"
                autoComplete="email"
                inputMode="email"
                placeholder="you@somewhere.kind"
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                error={status.kind === 'error' ? status.message : undefined}
                hint="No password, no app account — just a one-time sign-in link by email."
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={status.kind === 'submitting'}
                disabled={!email.trim()}
              >
                Send the link
              </Button>
            </motion.form>
          )}

          {/* Pull quote — closing line of the letter */}
          <motion.figure
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.7 }}
            className="mt-20 max-w-md"
          >
            <blockquote
              className="text-ink-500 italic text-[15px] leading-[1.7]"
              style={{ fontFamily: 'Instrument Serif, serif' }}
            >
              "We make time for what we love by being honest
              about how little of it we have."
            </blockquote>
            <figcaption className="mt-3 eyebrow text-ink-400">
              — From the Pod Life almanac
            </figcaption>
          </motion.figure>
        </motion.div>
      </main>

      {/* Small footer — colophon */}
      <footer className="relative z-10 px-6 sm:px-10 pb-6 max-w-5xl mx-auto w-full text-center sm:text-left">
        <p className="eyebrow text-ink-300">
          Built with care · {TODAY_FMT}
        </p>
      </footer>
    </div>
  );
}
